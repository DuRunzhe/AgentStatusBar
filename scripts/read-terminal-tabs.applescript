property requestedTtys : {}
property statusSeparator : character id 29
property recordSeparator : character id 30
property fieldSeparator : character id 31

on run targetTtys
  set requestedTtys to targetTtys

  if application "Terminal" is not running then
    return "not_running" & statusSeparator
  end if

  tell application "Terminal"
    set outputText to ""
    repeat with windowIndex from 1 to count of windows
      set terminalWindow to get item windowIndex of windows
      repeat with tabIndex from 1 to count of tabs of terminalWindow
        set tabTty to (get tty of (item tabIndex of tabs of terminalWindow)) as text
        if my requestedTtys contains tabTty then
          set tabContents to (get contents of (item tabIndex of tabs of terminalWindow)) as text
          set outputText to outputText & tabTty & my fieldSeparator & tabContents & my recordSeparator
        end if
      end repeat
    end repeat
    return "running" & my statusSeparator & outputText
  end tell
end run
