; PANOPTICA Setup (0.47; licence file and packages inside 0.49): one installer for every lab. It carries Node, a small helper
; and the release's signed packages, and no lab data. The lab's licence file decides what is installed: the helper reads it
; (signed by PANOPTICA), takes the package for its modules, checks it and installs it as a task that starts with the computer.
; No internet is needed. Built by the release workflow:
;   ISCC.exe /DAppVersion=0.49.0 installer\panoptica.iss
; with installer\build\ holding node\node.exe, helper.cjs and packages\ (tools/installer-build.mjs). Silent, for tests and IT:
;   PANOPTICA-Setup.exe /VERYSILENT /LICENCE=C:\path\licence.json [/LAN=0] [/DIR=C:\PANOPTICA]

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{4E1F7C52-9B3A-4C8E-A0D2-5B7E3F61C9A4}
AppName=PANOPTICA
AppVersion={#AppVersion}
AppVerName=PANOPTICA {#AppVersion}
AppPublisher=PANOPTICA
DefaultDirName=C:\PANOPTICA
DisableProgramGroupPage=yes
DisableReadyPage=no
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\out\installer
OutputBaseFilename=PANOPTICA-Setup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=PANOPTICA
SetupLogging=yes
CloseApplications=no

[Messages]
WelcomeLabel2=This installs PANOPTICA on this computer, as the lab's server: it runs in the background and starts with the computer.%n%nHave the lab's licence file (licence.json) ready. The internet is not needed.
FinishedHeadingLabel=PANOPTICA is installed
FinishedLabel=PANOPTICA is running. Open it to create the first admin and set up the lab.%n%nOn this computer: http://localhost:3000%nFrom the lab network: http://<this computer's name>:3000
FinishedLabelNoIcons=PANOPTICA is running. Open it to create the first admin and set up the lab.

[Files]
Source: "build\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
Source: "build\helper.cjs"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "..\release.pub"; DestDir: "{app}\installer"; Flags: ignoreversion
; the packages, unpacked only for the installation (Setup's temporary folder is removed at the end)
Source: "build\packages\*"; DestDir: "{tmp}\packages"; Flags: ignoreversion
; the same files, for the checks before anything is installed
Source: "build\node\node.exe"; Flags: dontcopy
Source: "build\helper.cjs"; Flags: dontcopy
Source: "..\release.pub"; Flags: dontcopy
Source: "build\packages\index.json"; Flags: dontcopy

[Run]
Filename: "http://localhost:3000"; Description: "Open PANOPTICA"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Stop-ScheduledTask -TaskName PANOPTICA -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName PANOPTICA -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PANOPTICA update' -Confirm:$false -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated; RunOnceId: "task"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=PANOPTICA"; Flags: runhidden waituntilterminated; RunOnceId: "firewall"

[Code]
var
  LicPage: TInputFileWizardPage;
  InfoPage: TOutputMsgMemoWizardPage;
  NetPage: TInputOptionWizardPage;
  Checked: Boolean;

function Q(S: String): String;
begin
  Result := '"' + S + '"';
end;

{ runs the helper with the Node this installer carries; waits for it }
function Helper(Args: String; var Code: Integer): Boolean;
begin
  Result := Exec(ExpandConstant('{tmp}\node.exe'), Q(ExpandConstant('{tmp}\helper.cjs')) + ' ' + Args, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

{ 0.50.2: an installed PANOPTICA is stopped before any file is replaced. Until then Setup run over a running install failed at
  node\node.exe ("DeleteFile failed; code 5"), which the running PANOPTICA holds open. The task is ended, then whatever still
  runs from this install's Node, and Setup waits until none is left. }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Node: String;
begin
  Result := '';
  Node := ExpandConstant('{app}\node\node.exe');
  if not FileExists(Node) then exit;
  Exec(ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    '-NoProfile -ExecutionPolicy Bypass -Command "$n = ''' + Node + '''; ' +
    'Stop-ScheduledTask -TaskName PANOPTICA -ErrorAction SilentlyContinue; ' +
    'for ($i = 0; $i -lt 30; $i++) { ' +
    '$p = @(Get-Process -Name node -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $n }); ' +
    'if ($p.Count -eq 0) { exit 0 }; ' +
    '$p | Stop-Process -Force -ErrorAction SilentlyContinue; Start-Sleep -Seconds 1 }; exit 1"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  if Code <> 0 then
    Result := 'PANOPTICA is running and could not be stopped. Restart this computer and run PANOPTICA Setup again. Nothing was changed.';
end;

{ reads the licence file; fills the next page, or says what is wrong }
function CheckLicence(): Boolean;
var
  Code: Integer;
  Ini, Err, Lab: String;
begin
  Result := False;
  ExtractTemporaryFile('node.exe');
  ExtractTemporaryFile('helper.cjs');
  ExtractTemporaryFile('release.pub');
  ExtractTemporaryFile('index.json');
  Ini := ExpandConstant('{tmp}\check.ini');
  DeleteFile(Ini);
  Helper('check --licence ' + Q(Trim(LicPage.Values[0])) + ' --packages ' + Q(ExpandConstant('{tmp}')) + ' --dir ' + Q(WizardDirValue) + ' --out ' + Q(Ini), Code);
  if GetIniString('result', 'ok', '0', Ini) <> '1' then begin
    Err := GetIniString('result', 'error', 'The licence file could not be read.', Ini);
    SuppressibleMsgBox(Err, mbError, MB_OK, IDOK);
    Exit;
  end;
  Lab := GetIniString('result', 'lab', '', Ini);
  if GetIniString('result', 'acronym', '', Ini) <> '' then
    Lab := Lab + ' (' + GetIniString('result', 'acronym', '', Ini) + ')';
  InfoPage.RichEditViewer.Lines.Text :=
    'Lab: ' + Lab + #13#10 +
    'Modules: ' + GetIniString('result', 'modules', '', Ini) + #13#10 +
    'People: ' + GetIniString('result', 'tier', '', Ini) + #13#10 + #13#10 +
    'PANOPTICA ' + GetIniString('result', 'version', '', Ini) + ' (' + GetIniString('result', 'size', '', Ini) + ') will be checked and installed.';
  if GetIniString('result', 'upgrade', '0', Ini) = '1' then
    InfoPage.RichEditViewer.Lines.Add(#13#10 + 'PANOPTICA is already installed here: its data stays, and the database is backed up first.');
  Checked := True;
  Result := True;
end;

procedure InitializeWizard;
begin
  LicPage := CreateInputFilePage(wpSelectDir, 'Licence file', 'The licence.json PANOPTICA gave the lab',
    'It decides which modules are installed. Lost it? Contact PANOPTICA for a copy.');
  LicPage.Add('Licence file:', 'Licence file (*.json)|*.json|All files|*.*', '.json');
  LicPage.Values[0] := ExpandConstant('{param:LICENCE|}');
  InfoPage := CreateOutputMsgMemoPage(LicPage.ID, 'What this licence covers', 'Check that this is the right lab',
    'PANOPTICA will be installed with:', '');
  { who can open it: until 0.50 moves this to PANOPTICA's own settings }
  NetPage := CreateInputOptionPage(InfoPage.ID, 'Network', 'Who can open PANOPTICA',
    'PANOPTICA runs in the background as the PANOPTICA task and starts with this computer.', False, False);
  NetPage.Add('Let other computers on the lab network open it (port 3000; a firewall rule is added)');
  NetPage.Values[0] := ExpandConstant('{param:LAN|1}') <> '0';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = LicPage.ID then begin
    if Trim(LicPage.Values[0]) = '' then begin
      SuppressibleMsgBox('Choose the licence file.', mbError, MB_OK, IDOK);
      Result := False;
    end else
      Result := CheckLicence();
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Lan: String;
begin
  { silent installs skip the pages: the licence is checked here }
  if (CurStep = ssInstall) and not Checked then
    if not CheckLicence() then Abort;
  if CurStep = ssPostInstall then begin
    if NetPage.Values[0] then Lan := '1' else Lan := '0';
    WizardForm.StatusLabel.Caption := 'Installing PANOPTICA and starting it (a minute or two)...';
    Exec(ExpandConstant('{app}\node\node.exe'), Q(ExpandConstant('{app}\installer\helper.cjs')) + ' install --licence ' + Q(Trim(LicPage.Values[0])) +
      ' --packages ' + Q(ExpandConstant('{tmp}\packages')) + ' --dir ' + Q(ExpandConstant('{app}')) + ' --lan ' + Lan, '', SW_HIDE, ewWaitUntilTerminated, Code);
    if Code <> 0 then
      SuppressibleMsgBox('PANOPTICA could not be installed. What happened is in ' + ExpandConstant('{app}\panoptica\updates\install.log') +
        '. Run PANOPTICA Setup again once it is fixed: nothing of the lab''s data was touched.', mbError, MB_OK, IDOK);
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usPostUninstall then
    SuppressibleMsgBox('PANOPTICA is stopped and removed from startup. The lab''s data and backups stay in ' +
      ExpandConstant('{app}\panoptica') + ': delete that folder to remove everything.', mbInformation, MB_OK, IDOK);
end;
