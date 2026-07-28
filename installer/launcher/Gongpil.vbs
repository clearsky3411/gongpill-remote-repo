Option Explicit

Dim fileSystem, shell, appRoot, commandLine, exitCode
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
commandLine = Quote(appRoot & "\runtime\node.exe") & " " & _
  Quote(appRoot & "\client\src\client-process.ts")
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & value & Chr(34)
End Function
