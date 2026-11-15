# PANOPTICA releases

This repository holds PANOPTICA's releases only: no source code.

Each release carries:

- **PANOPTICA Setup** (`PANOPTICA-Setup-<version>.exe`), the Windows installer for the lab's server. It installs PANOPTICA with the modules on the lab's licence file, which PANOPTICA gives each lab. Without a licence file it installs nothing.
- **The packages** (`panoptica-<modules>.zip`), one per combination of modules. Lab servers download the one they need from Admin settings › Updates. Each comes with its SHA-256 (`.sha256`) and PANOPTICA's signature (`.sig`); a server installs only packages signed by PANOPTICA.

The notes of each release say what changed for the people who use it.

To install PANOPTICA in a lab, or for a licence file, contact PANOPTICA.
