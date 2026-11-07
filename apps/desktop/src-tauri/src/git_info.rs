//! Etat git d'un dossier de projet, et ouverture de ce dossier dans le gestionnaire de fichiers.
//!
//! Tout est en lecture seule : `git status` et `git log`, jamais de commande qui ecrive. Le dossier
//! vient d'un agent (le chemin de projet qu'il rapporte) : on ne lance donc git qu'avec les
//! reglages qui empechent un depot piege d'executer du code (`core.fsmonitor`, hooks), sans verrou
//! optionnel, sans invite, et avec un delai maximal.

use crate::no_window::Quiet;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::Duration,
};

const GIT_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_CHANGED: usize = 60;
const MAX_COMMITS: usize = 5;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ChangedFile {
    pub path: String,
    /// Le code `git status` sur deux lettres, sans espaces : `M`, `A`, `D`, `R`, `??`, `UU`…
    pub status: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CommitLine {
    pub short_id: String,
    pub subject: String,
    pub relative_time: String,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RepositorySnapshot {
    pub root: String,
    pub project_hash: String,
    /// `None` quand la tete est detachee.
    pub branch: Option<String>,
    /// Commits en avance / en retard sur la branche amont ; `None` sans amont.
    pub ahead: Option<u32>,
    pub behind: Option<u32>,
    pub changed_files: Vec<ChangedFile>,
    /// Nombre total de fichiers modifies, au-dela de la liste plafonnee.
    pub changed_total: usize,
    pub recent_commits: Vec<CommitLine>,
}

/// Lance `git` dans `dir` avec un delai maximal ; `None` en cas d'echec ou de depassement.
fn run_git(dir: &Path, args: &[&str]) -> Option<String> {
    let mut child = Command::new("git")
        .arg("-C")
        .arg(dir)
        // Un depot pieges peut declarer un programme `core.fsmonitor` : on l'interdit.
        .args([
            "-c",
            "core.fsmonitor=false",
            "-c",
            "core.untrackedCache=false",
        ])
        .args(args)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .quiet()
        .spawn()
        .ok()?;
    let mut stdout = child.stdout.take()?;
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = stdout.read_to_end(&mut bytes);
        let _ = sender.send(bytes);
    });
    match receiver.recv_timeout(GIT_TIMEOUT) {
        Ok(bytes) => {
            let status = child.wait().ok()?;
            status
                .success()
                .then(|| String::from_utf8_lossy(&bytes).into_owned())
        }
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            None
        }
    }
}

/// `## main...origin/main [ahead 2, behind 1]` -> (Some("main"), Some(2), Some(1)).
pub fn parse_branch_line(line: &str) -> (Option<String>, Option<u32>, Option<u32>) {
    let rest = line.trim_start_matches("## ").trim();
    if rest.starts_with("HEAD (no branch)") {
        return (None, None, None);
    }
    if let Some(name) = rest.strip_prefix("No commits yet on ") {
        return (Some(name.trim().to_owned()), None, None);
    }
    if let Some(name) = rest.strip_prefix("Initial commit on ") {
        return (Some(name.trim().to_owned()), None, None);
    }
    let (names, tracking) = match rest.split_once(" [") {
        Some((names, tracking)) => (names, Some(tracking.trim_end_matches(']'))),
        None => (rest, None),
    };
    let branch = names.split("...").next().unwrap_or(names).trim().to_owned();
    let has_upstream = names.contains("...");
    let (mut ahead, mut behind) = (None, None);
    if has_upstream {
        // Sans « [ahead/behind] » apres l'amont, la branche est a jour : 0 et 0.
        ahead = Some(0);
        behind = Some(0);
    }
    if let Some(tracking) = tracking {
        for part in tracking.split(',') {
            let part = part.trim();
            if let Some(value) = part.strip_prefix("ahead ") {
                ahead = value.parse().ok();
            } else if let Some(value) = part.strip_prefix("behind ") {
                behind = value.parse().ok();
            }
        }
    }
    (Some(branch), ahead, behind)
}

/// Les lignes `XY chemin` de `git status --porcelain`, hors la ligne de branche.
pub fn parse_changed(output: &str) -> Vec<ChangedFile> {
    output
        .lines()
        .filter(|line| !line.starts_with("## ") && line.len() > 3)
        .map(|line| ChangedFile {
            status: line[..2].trim().to_owned(),
            path: line[3..].trim().trim_matches('"').to_owned(),
        })
        .collect()
}

fn parse_commits(output: &str) -> Vec<CommitLine> {
    output
        .lines()
        .filter_map(|line| {
            let mut parts = line.split('\u{1f}');
            Some(CommitLine {
                short_id: parts.next()?.to_owned(),
                subject: parts.next()?.to_owned(),
                relative_time: parts.next()?.to_owned(),
            })
        })
        .collect()
}

/// L'etat git du dossier, ou une erreur lisible quand ce n'est pas un depot.
pub fn snapshot(path: &str) -> Result<RepositorySnapshot, String> {
    let dir = Path::new(path);
    if !dir.is_absolute() || !dir.is_dir() {
        return Err("not a directory".to_owned());
    }
    let root = run_git(dir, &["rev-parse", "--show-toplevel"])
        .map(|output| output.trim().to_owned())
        .filter(|root| !root.is_empty())
        .ok_or_else(|| "not a git repository".to_owned())?;
    let status = run_git(
        dir,
        &[
            "status",
            "--porcelain=v1",
            "--branch",
            "--untracked-files=normal",
        ],
    )
    .ok_or_else(|| "git status failed".to_owned())?;
    let (branch, ahead, behind) = status
        .lines()
        .next()
        .filter(|line| line.starts_with("## "))
        .map(parse_branch_line)
        .unwrap_or((None, None, None));
    let mut changed = parse_changed(&status);
    let changed_total = changed.len();
    changed.truncate(MAX_CHANGED);
    let recent_commits = run_git(
        dir,
        &[
            "log",
            "-n",
            &MAX_COMMITS.to_string(),
            "--format=%h%x1f%s%x1f%cr",
        ],
    )
    .map(|output| parse_commits(&output))
    .unwrap_or_default();
    let mut hasher = Sha256::new();
    hasher.update(root.as_bytes());
    let project_hash = format!("{:x}", hasher.finalize())[..16].to_owned();
    Ok(RepositorySnapshot {
        root,
        project_hash,
        branch,
        ahead,
        behind,
        changed_files: changed,
        changed_total,
        recent_commits,
    })
}

/// Ouvre un dossier (ou le dossier d'un fichier) dans le gestionnaire de fichiers.
///
/// Seul un dossier est ouvert, jamais un fichier : ouvrir un fichier avec le programme par defaut
/// pourrait lancer un executable. Le chemin vient d'un agent, il est donc verifie.
pub fn reveal(path: &str) -> Result<(), String> {
    let target = Path::new(path);
    if !target.is_absolute() {
        return Err("not an absolute path".to_owned());
    }
    let folder = if target.is_dir() {
        target
    } else {
        target
            .parent()
            .filter(|parent| parent.is_dir())
            .ok_or_else(|| "no such folder".to_owned())?
    };
    #[cfg(target_os = "macos")]
    let program = "open";
    #[cfg(target_os = "windows")]
    let program = "explorer";
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    let program = "xdg-open";
    Command::new(program)
        .arg(folder)
        .quiet()
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_the_branch_line() {
        assert_eq!(
            parse_branch_line("## main...origin/main [ahead 2, behind 1]"),
            (Some("main".into()), Some(2), Some(1))
        );
        assert_eq!(
            parse_branch_line("## main...origin/main [ahead 3]"),
            (Some("main".into()), Some(3), Some(0))
        );
        assert_eq!(
            parse_branch_line("## main...origin/main"),
            (Some("main".into()), Some(0), Some(0))
        );
        assert_eq!(
            parse_branch_line("## feature/x"),
            (Some("feature/x".into()), None, None)
        );
        assert_eq!(parse_branch_line("## HEAD (no branch)"), (None, None, None));
        assert_eq!(
            parse_branch_line("## No commits yet on main"),
            (Some("main".into()), None, None)
        );
    }

    #[test]
    fn reads_changed_files() {
        let list = parse_changed("## main\n M src/a.rs\n?? new file.txt\nR  old.rs -> new.rs\n");
        assert_eq!(list.len(), 3);
        assert_eq!(
            list[0],
            ChangedFile {
                path: "src/a.rs".into(),
                status: "M".into()
            }
        );
        assert_eq!(list[1].status, "??");
        assert_eq!(list[2].status, "R");
    }

    #[test]
    fn refuses_what_is_not_an_absolute_folder() {
        assert!(snapshot("relative/path").is_err());
        assert!(snapshot("/definitely/not/here").is_err());
        assert!(reveal("relative").is_err());
        assert!(reveal("/definitely/not/here/file.txt").is_err());
    }

    #[test]
    fn describes_a_real_repository() {
        if Command::new("git").arg("--version").output().is_err() {
            return;
        }
        let dir = std::env::temp_dir().join(format!("ao-git-test-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let git = |args: &[&str]| {
            let status = Command::new("git")
                .arg("-C")
                .arg(&dir)
                .args([
                    "-c",
                    "user.name=t",
                    "-c",
                    "user.email=t@t",
                    "-c",
                    "commit.gpgsign=false",
                ])
                .args(args)
                .output()
                .unwrap();
            assert!(status.status.success(), "git {args:?} failed");
        };
        git(&["init", "-q", "-b", "main"]);
        fs::write(dir.join("a.txt"), "one").unwrap();
        git(&["add", "."]);
        git(&["commit", "-q", "-m", "first commit"]);
        fs::write(dir.join("a.txt"), "two").unwrap();
        fs::write(dir.join("b.txt"), "new").unwrap();

        let shot = snapshot(dir.to_str().unwrap()).unwrap();
        assert_eq!(shot.branch.as_deref(), Some("main"));
        assert_eq!(shot.ahead, None);
        assert_eq!(shot.changed_total, 2);
        assert!(
            shot.changed_files
                .iter()
                .any(|file| file.path == "a.txt" && file.status == "M")
        );
        assert!(
            shot.changed_files
                .iter()
                .any(|file| file.path == "b.txt" && file.status == "??")
        );
        assert_eq!(shot.recent_commits.len(), 1);
        assert_eq!(shot.recent_commits[0].subject, "first commit");
        assert_eq!(shot.project_hash.len(), 16);
        // Un sous-dossier donne le meme depot.
        fs::create_dir_all(dir.join("sub")).unwrap();
        let from_sub = snapshot(dir.join("sub").to_str().unwrap()).unwrap();
        assert_eq!(from_sub.root, shot.root);
        let _ = fs::remove_dir_all(&dir);
    }
}
