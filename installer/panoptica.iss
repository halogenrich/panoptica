; PANOPTICA Setup (0.47): one installer for every lab. It carries Node and a small helper, no module and no lab data. The lab's
; product key decides what is installed: the helper asks PANOPTICA's activation service what the key covers, downloads that
; package (signed by PANOPTICA) and installs it as a task that starts with the computer. Built by the release workflow:
;   ISCC.exe /DAppVersion=0.47.0 /DService=https://… installer\panoptica.iss
; with installer\build\ holding node\node.exe and helper.cjs (tools/installer-build.mjs). Silent, for tests and IT:
;   PANOPTICA-Setup.exe /VERYSILENT /KEY=XXXXX-… [/SERVICE=https://…] [/LAN=0] [/DIR=C:\PANOPTICA]

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef Service
  #define Service ""
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
WelcomeLabel2=This installs PANOPTICA on this computer, as the lab's server: it runs in the background and starts with the computer.%n%nHave the lab's product key ready. This computer needs the internet during the installation; afterwards PANOPTICA runs without it.
FinishedHeadingLabel=PANOPTICA is installed
FinishedLabel=PANOPTICA is running. Open it and type the product key once more to create the first admin and set up the lab.%n%nOn this computer: http://localhost:3000%nFrom the lab network: http://<this computer's name>:3000
FinishedLabelNoIcons=PANOPTICA is running. Open it and type the product key once more to create the first admin and set up the lab.

[Files]
Source: "build\node\*"; DestDir: "{app}\node"; Flags: recursesubdirs ignoreversion
Source: "build\helper.cjs"; DestDir: "{app}\installer"; Flags: ignoreversion
Source: "..\release.pub"; DestDir: "{app}\installer"; Flags: ignoreversion
; the same files, for the checks before anything is installed
Source: "build\node\node.exe"; Flags: dontcopy
Source: "build\helper.cjs"; Flags: dontcopy
Source: "..\release.pub"; Flags: dontcopy

[Run]
Filename: "http://localhost:3000"; Description: "Open PANOPTICA"; Flags: postinstall shellexec nowait skipifsilent

[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Stop-ScheduledTask -TaskName PANOPTICA -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName PANOPTICA -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'PANOPTICA update' -Confirm:$false -ErrorAction SilentlyContinue"""; Flags: runhidden waituntilterminated; RunOnceId: "task"
Filename: "{sys}\netsh.exe"; Parameters: "advfirewall firewall delete rule name=PANOPTICA"; Flags: runhidden waituntilterminated; RunOnceId: "firewall"

[Code]
var
  KeyPage: TInputQueryWizardPage;
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

{ asks PANOPTICA what the key covers; fills the next page, or says what is wrong }
function CheckKey(): Boolean;
var
  Code: Integer;
  Ini, Err: String;
begin
  Result := False;
  ExtractTemporaryFile('node.exe');
  ExtractTemporaryFile('helper.cjs');
  ExtractTemporaryFile('release.pub');
  Ini := ExpandConstant('{tmp}\check.ini');
  DeleteFile(Ini);
  Helper('check --key ' + Q(Trim(KeyPage.Values[0])) + ' --service ' + Q(Trim(KeyPage.Values[1])) + ' --dir ' + Q(WizardDirValue) + ' --out ' + Q(Ini), Code);
  if GetIniString('result', 'ok', '0', Ini) <> '1' then begin
    Err := GetIniString('result', 'error', 'The product key could not be checked. Is this computer on the internet?', Ini);
    SuppressibleMsgBox(Err, mbError, MB_OK, IDOK);
    Exit;
  end;
  InfoPage.RichEditViewer.Lines.Text :=
    'Lab: ' + GetIniString('result', 'lab', '', Ini) + #13#10 +
    'Modules: ' + GetIniString('result', 'modules', '', Ini) + #13#10 +
    'Updates until: ' + GetIniString('result', 'updates', '', Ini) + #13#10 +
    'Computers with this key: ' + GetIniString('result', 'computers', '', Ini) + #13#10 + #13#10 +
    'PANOPTICA ' + GetIniString('result', 'version', '', Ini) + ' (' + GetIniString('result', 'size', '', Ini) + ') will be downloaded and checked.';
  if GetIniString('result', 'upgrade', '0', Ini) = '1' then
    InfoPage.RichEditViewer.Lines.Add(#13#10 + 'PANOPTICA is already installed here: its data stays, and the database is backed up first.');
  Checked := True;
  Result := True;
end;

procedure InitializeWizard;
begin
  KeyPage := CreateInputQueryPage(wpSelectDir, 'Product key', 'The key PANOPTICA gave the lab',
    'It decides which modules are installed. PANOPTICA checks it now, over the internet.');
  KeyPage.Add('Product key:', False);
  KeyPage.Add('Activation service:', False);
  KeyPage.Values[0] := ExpandConstant('{param:KEY|}');
  KeyPage.Values[1] := ExpandConstant('{param:SERVICE|{#Service}}');
  InfoPage := CreateOutputMsgMemoPage(KeyPage.ID, 'What this key covers', 'Check that this is the right lab',
    'PANOPTICA will be installed with:', '');
  NetPage := CreateInputOptionPage(InfoPage.ID, 'Network', 'Who can open PANOPTICA',
    'PANOPTICA runs in the background as the PANOPTICA task and starts with this computer.', False, False);
  NetPage.Add('Let other computers on the lab network open it (port 3000; a firewall rule is added)');
  NetPage.Values[0] := ExpandConstant('{param:LAN|1}') <> '0';
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = KeyPage.ID then begin
    if Trim(KeyPage.Values[0]) = '' then begin
      SuppressibleMsgBox('Type the product key.', mbError, MB_OK, IDOK);
      Result := False;
    end else
      Result := CheckKey();
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Code: Integer;
  Lan: String;
begin
  { silent installs skip the pages: the key is checked here }
  if (CurStep = ssInstall) and not Checked then
    if not CheckKey() then Abort;
  if CurStep = ssPostInstall then begin
    if NetPage.Values[0] then Lan := '1' else Lan := '0';
    WizardForm.StatusLabel.Caption := 'Downloading PANOPTICA and starting it (a minute or two)...';
    Exec(ExpandConstant('{app}\node\node.exe'), Q(ExpandConstant('{app}\installer\helper.cjs')) + ' install --key ' + Q(Trim(KeyPage.Values[0])) +
      ' --service ' + Q(Trim(KeyPage.Values[1])) + ' --dir ' + Q(ExpandConstant('{app}')) + ' --lan ' + Lan, '', SW_HIDE, ewWaitUntilTerminated, Code);
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
