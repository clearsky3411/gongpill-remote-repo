Option Explicit

Dim fileSystem, shell, appRoot, commandLine, exitCode, argument
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

appRoot = fileSystem.GetParentFolderName(WScript.ScriptFullName)
commandLine = Quote(appRoot & "\runtime\node.exe") & " " & _
  Quote(appRoot & "\client\src\client-process.ts")
For Each argument In WScript.Arguments
  commandLine = commandLine & " " & Quote(argument)
Next
exitCode = shell.Run(commandLine, 0, True)
WScript.Quit exitCode

Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
