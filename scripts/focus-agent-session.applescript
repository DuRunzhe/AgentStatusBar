on run argv
    set targetTTY to item 1 of argv

    try
        if application "Terminal" is running then
            tell application "Terminal"
                repeat with theWindow in windows
                    repeat with theTab in tabs of theWindow
                        if tty of theTab is targetTTY then
                            set selected tab of theWindow to theTab
                            set index of theWindow to 1
                            activate
                            return "Terminal"
                        end if
                    end repeat
                end repeat
            end tell
        end if
    end try

    try
        if application "iTerm2" is running then
            tell application "iTerm2"
                repeat with theWindow in windows
                    repeat with theTab in tabs of theWindow
                        repeat with theSession in sessions of theTab
                            if tty of theSession is targetTTY then
                                tell theSession to select
                                activate
                                return "iTerm2"
                            end if
                        end repeat
                    end repeat
                end repeat
            end tell
        end if
    end try

    return ""
end run
