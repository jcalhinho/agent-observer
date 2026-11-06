//! Inspection des processus locaux : qui tourne, et sur quels ports.
//!
//! Extrait de l'ancien module `focus`, dont le reste servait a ramener au
//! premier plan la fenetre d'un agent. Cette partie-la est partie avec la
//! simplification ; ce qui reste ici est ce dont les lecteurs d'agents ont
//! besoin pour trouver le serveur local d'une application.

use crate::no_window::Quiet;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

/// Ce qu'on retient d'un processus.
#[derive(Debug, Clone, PartialEq)]
pub struct ProcInfo {
    pub pid: u32,
    pub parent: Option<u32>,
    pub name: String,
    pub cmd: String,
    pub exe: Option<String>,
    pub cwd: Option<String>,
    pub start_time: u64,
}

/// Un instantane de tous les processus, avec ce qu'il nous en faut.
pub fn snapshot() -> Vec<ProcInfo> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_cmd(UpdateKind::Always)
            .with_exe(UpdateKind::Always)
            .with_cwd(UpdateKind::Always),
    );
    system
        .processes()
        .values()
        .map(|process| ProcInfo {
            pid: process.pid().as_u32(),
            parent: process.parent().map(Pid::as_u32),
            name: process.name().to_string_lossy().into_owned(),
            cmd: process
                .cmd()
                .iter()
                .map(|part| part.to_string_lossy())
                .collect::<Vec<_>>()
                .join(" "),
            exe: process.exe().map(|path| path.display().to_string()),
            cwd: process.cwd().map(|path| path.display().to_string()),
            start_time: process.start_time(),
        })
        .collect()
}

/// Ports TCP sur lesquels un processus ecoute, pour trouver le serveur
/// local d'une application.
pub fn listening_ports(pid: u32) -> Vec<u16> {
    #[cfg(target_os = "windows")]
    {
        let Ok(output) = std::process::Command::new("netstat")
            .quiet()
            .args(["-ano", "-p", "TCP"])
            .output()
        else {
            return Vec::new();
        };
        parse_netstat_listening(&String::from_utf8_lossy(&output.stdout), pid)
    }
    #[cfg(not(target_os = "windows"))]
    {
        let Ok(output) = std::process::Command::new("lsof")
            .quiet()
            .args([
                "-nP",
                "-a",
                "-p",
                &pid.to_string(),
                "-iTCP",
                "-sTCP:LISTEN",
                "-Fn",
            ])
            .output()
        else {
            return Vec::new();
        };
        parse_lsof_listening(&String::from_utf8_lossy(&output.stdout))
    }
}

#[cfg_attr(not(target_os = "windows"), allow(dead_code))]
fn parse_netstat_listening(text: &str, pid: u32) -> Vec<u16> {
    text.lines()
        .filter_map(|line| {
            let parts: Vec<&str> = line.split_whitespace().collect();
            (parts.len() >= 5
                && parts[3] == "LISTENING"
                && parts[4].parse::<u32>().ok() == Some(pid))
            .then(|| parts[1].rsplit(':').next()?.parse::<u16>().ok())
            .flatten()
        })
        .collect()
}

#[cfg_attr(target_os = "windows", allow(dead_code))]
fn parse_lsof_listening(text: &str) -> Vec<u16> {
    text.lines()
        .filter_map(|line| {
            line.strip_prefix('n')?
                .rsplit(':')
                .next()?
                .parse::<u16>()
                .ok()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_listening_ports_from_lsof_and_netstat() {
        assert_eq!(
            parse_lsof_listening("p64451\nn127.0.0.1:53673\nn*:8080\nn[::1]:9000\n"),
            [53673, 8080, 9000]
        );
        let netstat = "  TCP    127.0.0.1:53674    0.0.0.0:0    LISTENING    64451\n  TCP    127.0.0.1:50000    127.0.0.1:53674    ESTABLISHED    64451\n  TCP    0.0.0.0:135    0.0.0.0:0    LISTENING    900\n";
        assert_eq!(parse_netstat_listening(netstat, 64451), [53674]);
    }
}
