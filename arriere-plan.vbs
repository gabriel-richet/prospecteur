' Lance le Prospecteur en arriere-plan, sans fenetre (utilise par LANCER.bat et par le demarrage de Windows).
' Les messages du serveur vont dans donnees\journal.log.
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")
dossier = fso.GetParentFolderName(WScript.ScriptFullName)
sh.CurrentDirectory = dossier
If Not fso.FolderExists(dossier & "\donnees") Then fso.CreateFolder(dossier & "\donnees")
sh.Run "cmd /c node serveur.mjs --sans-navigateur >> donnees\journal.log 2>&1", 0, False
