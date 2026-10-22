' Starts the Dharma Player server (hidden) if it isn't running, then opens it in its own app window.
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:4747"

running = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP")
http.setTimeouts 500, 500, 500, 500
http.Open "GET", url & "/api/status", False
http.Send
If Err.Number = 0 And http.Status = 200 Then running = True
On Error GoTo 0

If Not running Then
  sh.CurrentDirectory = dir
  sh.Run "cmd /c node server.js >> data\server.log 2>&1", 0, False
  WScript.Sleep 1200
End If

chrome = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\Google\Chrome\Application\chrome.exe"
If Not fso.FileExists(chrome) Then chrome = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Google\Chrome\Application\chrome.exe"
If Not fso.FileExists(chrome) Then chrome = sh.ExpandEnvironmentStrings("%LocalAppData%") & "\Google\Chrome\Application\chrome.exe"
If fso.FileExists(chrome) Then
  sh.Run """" & chrome & """ --app=" & url & " --window-size=1360,880", 1, False
Else
  sh.Run "msedge --app=" & url & " --window-size=1360,880", 1, False
End If
