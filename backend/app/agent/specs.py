READ_ONLY = ["read_file", "list_dir", "glob", "grep", "web_search", "web_fetch", "todo_write", "job_output", "monitor", "advisor", "ask_user", "use_skill", "memory", "screenshot", "exit_plan_mode"]
BROWSER_READ_ONLY = ["screenshot", "read", "tabs", "wait"]
COMPUTER_READ_ONLY = ["screenshot", "info", "windows", "wait"]


def fn(name, description, properties, required=None):
    parameters = {"type": "object", "properties": properties}
    if required:
        parameters["required"] = required
    return {"type": "function", "function": {"name": name, "description": description, "parameters": parameters}}


def string(description):
    return {"type": "string", "description": description}


def integer(description):
    return {"type": "integer", "description": description}


def boolean(description):
    return {"type": "boolean", "description": description}


BUILTIN = [
    fn("read_file", "Read a text file with line numbers. Use offset and limit for big files. Images are shown to you when your model can see.", {
        "path": string("File path, relative to the project folder or absolute inside it."),
        "offset": integer("First line to read, starting at 1."),
        "limit": integer("How many lines to read, default 800."),
    }, ["path"]),
    fn("write_file", "Create a new file or replace a whole file. Folders are created for you. Prefer edit_file for small changes in existing files.", {
        "path": string("File path."),
        "content": string("The complete content of the file."),
    }, ["path", "content"]),
    fn("edit_file", "Replace exact text in a file. old_string must match the file exactly, including spaces, and must be unique unless replace_all is true. Read the file first.", {
        "path": string("File path."),
        "old_string": string("The exact text to replace."),
        "new_string": string("The new text."),
        "replace_all": boolean("Replace every match instead of one."),
    }, ["path", "old_string", "new_string"]),
    fn("multi_edit", "Make several exact text replacements in one file at once. Edits are applied in order and all must succeed.", {
        "path": string("File path."),
        "edits": {"type": "array", "items": {"type": "object", "properties": {
            "old_string": {"type": "string"},
            "new_string": {"type": "string"},
            "replace_all": {"type": "boolean"},
        }, "required": ["old_string", "new_string"]}},
    }, ["path", "edits"]),
    fn("list_dir", "List files and folders as a tree. Big folders like node_modules are skipped.", {
        "path": string("Folder, default is the project folder."),
        "depth": integer("How deep to go, default 3."),
    }),
    fn("glob", "Find files by name pattern, for example **/*.jsx or src/**/test_*.py.", {
        "pattern": string("Glob pattern."),
        "path": string("Folder to search in."),
    }, ["pattern"]),
    fn("grep", "Search file contents with a regular expression. Returns matching lines with file and line number.", {
        "pattern": string("Regular expression."),
        "path": string("Folder or file to search in."),
        "include": string("Only files matching this glob, for example *.py"),
        "ignore_case": boolean("Ignore upper and lower case."),
        "context": integer("Lines of context around each match."),
    }, ["pattern"]),
    fn("bash", "Run a shell command on your Linux computer in the project folder. Internet works. Use run_in_background for servers, watchers and long jobs, then read them with job_output.", {
        "command": string("The command to run."),
        "description": string("A few words about what it does, shown to the user."),
        "timeout": integer("Seconds before it is stopped, default 180, at most 900."),
        "run_in_background": boolean("Start it in the background and return at once."),
    }, ["command"]),
    fn("job_output", "Read the output of a background job and see if it is still running.", {
        "job_id": string("The id returned by bash with run_in_background."),
    }, ["job_id"]),
    fn("monitor", "Wait on a background job or service until its output shows a line you expect (until), shows a failure (fail), the job stops, or the timeout passes. Use it instead of sleep loops, for example after starting a server: until \"ready|listening|Local:\", fail \"error|EADDRINUSE\".", {
        "job_id": string("The job id from bash run_in_background, or a service name."),
        "until": string("A regular expression; returns as soon as a new output line matches."),
        "fail": string("A regular expression for lines that mean it failed."),
        "timeout": integer("Seconds to wait, default 60, at most 300."),
        "only_new": boolean("Ignore output printed before this call. Default false: the job's whole log counts."),
    }, ["job_id"]),
    fn("kill_job", "Stop a background job.", {
        "job_id": string("The job id."),
    }, ["job_id"]),
    fn("service", "Keep a server running (dev server, API, database, worker). Forkwise watches it, checks that its port answers, and starts it again by itself if the computer restarts. Prefer this over bash run_in_background for anything the user will open. "
        "Actions: start (name, command, port, cwd, path), stop, restart, status (all services with health and recent log), logs.", {
        "action": string("start | stop | restart | status | logs"),
        "name": string("Short service name, for example web or api."),
        "command": string("For start: the command, for example npm run dev or .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port 8000. Listen on 0.0.0.0."),
        "port": integer("For start: the port it listens on; Forkwise waits until it answers."),
        "cwd": string("For start: folder inside the project to run it in. Default the project folder."),
        "path": string("For start: URL path to check, default /."),
    }, ["action"]),
    fn("scaffold", "Create a new project from a tested starter with versions that work together, install its packages, run its tests and start its servers. Use it to begin any new web app, site or API instead of writing config by hand. "
        "Templates: react (React + Vite + Tailwind CSS 4 + Router), api (FastAPI + SQLite + pytest), fullstack (both, wired together with an /api proxy), static (plain HTML/CSS/JS). Then build the real product on top.", {
        "template": string("react | api | fullstack | static"),
        "folder": string("New folder inside the project, for example shop."),
        "title": string("Product name shown in the starter."),
        "start": boolean("Start the servers after installing (default true)."),
    }, ["template", "folder"]),
    fn("preview", "Show a web app that is running on your computer to the user in the live Preview panel. Start the server first with bash run_in_background, listening on 0.0.0.0. Returns the public preview link.", {
        "port": integer("The port the app listens on."),
        "command": string("The command that starts the server, so the preview can be restarted later."),
        "path": string("Page to open first, default /"),
    }, ["port"]),
    fn("screenshot", "Open a page in a real Chromium browser on your computer and take a screenshot. Also returns console errors. Use it to check how a site really looks and to read pages that need JavaScript.", {
        "url": string("For your own apps use http://localhost:PORT/path. Public links work too."),
        "width": integer("Viewport width, default 1280. Use 390 to check mobile."),
        "full_page": boolean("Capture the whole page, not only the first screen."),
        "wait_ms": integer("Extra wait after load in milliseconds, default 800."),
    }, ["url"]),
    fn("browser", "Drive a real Chromium browser that stays open between calls, with tabs. Every call returns the open tabs, a numbered list of clickable elements on screen (refs) and a screenshot. Use it to log in, fill forms, click through sites, test your own apps end to end and read pages that need interaction. Prefer ref numbers from the latest result when clicking or typing.", {
        "action": {"type": "string", "enum": ["open", "click", "type", "press", "select", "hover", "scroll", "back", "forward", "reload", "screenshot", "read", "tabs", "switch_tab", "close_tab", "eval", "wait", "close"], "description": "open: go to url (new_tab for a new tab). type: type input into ref/selector (or the focused element). press: a key like Enter, Tab, Control+A. read: also return the page text. eval: run JavaScript."},
        "url": string("For open. Your own apps are on http://localhost:PORT."),
        "new_tab": boolean("For open: open the url in a new tab."),
        "ref": integer("Element number from the latest result, for click, type, select and hover."),
        "selector": string("CSS selector, if there is no ref."),
        "text": string("Click the element with this visible text, if there is no ref."),
        "x": integer("Click at this x position of the screenshot."),
        "y": integer("Click at this y position of the screenshot."),
        "double": boolean("Double click."),
        "input": string("Text to type, for type."),
        "value": string("Option value or label, for select."),
        "submit": boolean("Press Enter after typing."),
        "key": string("Key for press."),
        "direction": {"type": "string", "enum": ["down", "up"]},
        "amount": integer("Pixels to scroll (default 600) or milliseconds to wait."),
        "tab": integer("Tab index for switch_tab and close_tab."),
        "script": string("JavaScript expression for eval."),
        "full_page": boolean("Screenshot the whole page."),
    }, ["action"]),
    fn("web_search", "Search the internet. Use it for anything current: prices, exchange rates, news, weather, versions, documentation.", {
        "query": string("The search query. Use the language that gives the best results."),
    }, ["query"]),
    fn("web_fetch", "Open a public web page or API and return its text.", {
        "url": string("The link."),
        "max_chars": integer("Most characters to return, default 20000."),
    }, ["url"]),
    fn("todo_write", "Create or update your task list for this job. The user sees it live. Send the whole list each time. Keep exactly one item in_progress while you work.", {
        "todos": {"type": "array", "items": {"type": "object", "properties": {
            "content": {"type": "string"},
            "status": {"type": "string", "enum": ["pending", "in_progress", "completed"]},
        }, "required": ["content", "status"]}},
    }, ["todos"]),
    fn("memory", "Long term memory about the user that stays across all chats. Use it when the user asks you to remember or forget something, or tells you a lasting fact or preference. Never use files for this.", {
        "action": {"type": "string", "enum": ["save", "delete", "list"]},
        "content": string("The fact to remember, one short sentence, for save."),
        "id": string("Memory id, for delete."),
        "scope": {"type": "string", "enum": ["user", "project"], "description": "user: everywhere. project: only in this project."},
    }, ["action"]),
    fn("ask_user", "Ask the user a question and wait for the answer. Only for decisions that truly belong to the user. Give clear options when you can.", {
        "question": string("The question."),
        "options": {"type": "array", "items": {"type": "string"}, "description": "Possible answers to click."},
    }, ["question"]),
    fn("task", "Give a self-contained job to a helper agent with its own fresh context, and get its final report. explore: read-only, for searching a codebase or researching the web. general: can change files and run commands.", {
        "description": string("Three to six words, shown to the user."),
        "prompt": string("Full instructions. The helper cannot see this chat, so include everything it needs."),
        "agent": {"type": "string", "enum": ["explore", "general"]},
    }, ["description", "prompt"]),
    fn("show_file", "Show a file you made to the user as a card with a preview and a download button. Use it for results like images, videos, audio, PDFs, documents, zip files and data exports.", {
        "path": string("File path."),
        "caption": string("One line about the file."),
    }, ["path"]),
    fn("generate_image", "Create a picture from a text description with an AI image model: photos, illustrations, logos, product shots, backgrounds, art. It saves the image in the project and shows it to the user. Use it whenever the user wants an image. Do not draw pictures with code unless a chart or vector graphic is clearly better.", {
        "prompt": string("A detailed description in English: subject, style, colours, lighting, composition, mood."),
        "path": string("Where to save it, for example images/airplane.jpg. Optional."),
        "size": string("square (default), landscape (16:9) or portrait (9:16)."),
    }, ["prompt"]),
    fn("video", "Make professional animated videos (stories with characters, ads, explainers, YouTube 2-20 min, reels) with Forkwise Motion. "
        "You write the animation yourself: every scene is an HTML page animated with code (FW helpers, CSS, SVG, canvas, three.js, lottie), rigged characters that walk, talk with lip-sync, blink and act, "
        "camera moves, transitions, natural voices per character, sound effects, music and subtitles. Nothing is a fixed template. Load the video-making skill first (use_skill video-making). "
        "Actions: new (create the project folder), voice (make the voices and get exact line timings), storyboard (one frame of every scene, shown to the user), "
        "preview (frames of one scene at chosen times, for you to check), render (draft or final video; final also gives the source as a zip), "
        "transcribe (word-timed transcript of a video or audio file the user gave, for editing real footage), cuts (keep-ranges of that file with pauses and filler words removed), "
        "beats (tempo and beat times of a music file, to cut and animate on the beat).", {
        "action": string("new | voice | storyboard | preview | render | transcribe | cuts | beats"),
        "file": string("For transcribe, cuts and beats: the media file inside the project, for example assets/raw/interview.mp4."),
        "gap": string("For cuts: pauses longer than this many seconds are cut (default 0.45; 0.25 for fast social edits)."),
        "project": string("Project folder, for example video (default)."),
        "size": string("For new: 16:9 (YouTube), 9:16 (Reels, TikTok, Shorts), 1:1, 4:5 or 4k."),
        "language": string("For new: language code of the voices and text, for example fa or en."),
        "scene": integer("For preview: scene number (1 = first)."),
        "times": string("For preview: seconds inside the scene, comma separated, for example 0.5,2,3.5. Leave empty for 5 evenly spread frames."),
        "scenes": string("For render: only these scenes, for example 1-3,7 (still puts them together)."),
        "draft": boolean("For render: fast half-size preview. Use it to check timing and motion, then render the final."),
        "output": string("For render: file name inside the project, default out/video.mp4."),
    }, ["action"]),
    fn("create_tool", "Give yourself a new permanent tool. Write a Python 3 script that reads its JSON arguments from stdin and prints the result. It runs on your computer with internet. After it is created you can call it as my_<name> in this and every later chat. Use it for capabilities you will need again.", {
        "name": string("Short snake_case name."),
        "description": string("What the tool does and when to use it."),
        "parameters": {"type": "object", "description": "JSON schema of the arguments, type object with properties."},
        "code": string("Python 3 code. Read input with: import sys, json; args = json.load(sys.stdin). Print the result."),
        "test_input": {"type": "object", "description": "Arguments for a test run right after saving."},
    }, ["name", "description", "parameters", "code"]),
    fn("save_skill", "Save a reusable skill: step by step instructions for a kind of job, loaded later with use_skill in any chat.", {
        "name": string("Short kebab-case name."),
        "description": string("When to use this skill."),
        "instructions": string("Markdown instructions."),
    }, ["name", "description", "instructions"]),
    fn("use_skill", "Load the full instructions of a saved skill.", {
        "name": string("Skill name."),
    }, ["name"]),
]

PLAN_TOOL = fn("exit_plan_mode", "Present your finished plan to the user for approval. Call it once, when the plan is complete. The user can approve it to start building.", {
    "plan": string("The plan in Markdown: goal, steps, files to create or change, how you will verify it."),
}, ["plan"])


def names(spec_list):
    result = []
    for spec in spec_list:
        result.append(spec["function"]["name"])
    return result


def pick(wanted):
    result = []
    for spec in BUILTIN:
        if spec["function"]["name"] in wanted:
            result.append(spec)
    return result


EXPLORE_TOOLS = ["read_file", "list_dir", "glob", "grep", "web_search", "web_fetch", "screenshot"]
GENERAL_EXCLUDE = ["task", "ask_user", "todo_write", "memory", "create_tool", "save_skill"]


def explore_specs():
    return pick(EXPLORE_TOOLS)


def general_specs():
    result = []
    for spec in BUILTIN:
        if spec["function"]["name"] not in GENERAL_EXCLUDE:
            result.append(spec)
    return result


def plan_specs():
    result = []
    for spec in BUILTIN:
        name = spec["function"]["name"]
        if name in READ_ONLY or name == "task":
            result.append(spec)
    result.append(PLAN_TOOL)
    return result


def computer_spec(devices):
    names = ", ".join(device["name"] + " (" + (device.get("platform") or "unknown OS") + ")" for device in devices)
    mine = ""
    for device in devices:
        if device.get("chrome"):
            mine = device.get("chrome_name") or "Chrome"
    own = " The user has not connected their own browser yet; if a task needs their signed in sessions, tell them to add Forkwise for Chrome from Settings, Computer in the Forkwise app."
    if mine:
        own = " The user's own browser (" + mine + ") is connected through Forkwise for Chrome: set browser to mine to work in their real browser with their sign-ins (email, GitHub, dashboards, shops). It opens your tabs in a purple Forkwise tab group, and the user is asked once per site, so tell them what site you are about to open. Prefer mine whenever the task needs an account they are signed in to."
    return fn("computer", "Control the user's own computer through the Forkwise Desktop app they connected: " + names + ". This is their real machine, not your sandbox. Use it only when the user asks for something on their computer. You can run commands in a full terminal (PowerShell on Windows, the login shell elsewhere), open apps (code, notepad, chrome...), files, folders, links in their browser and system settings (on Windows ms-settings: links such as ms-settings:display), read, write and list files, change the wallpaper, switch windows, use the clipboard, take screenshots, and use the mouse and keyboard. For web pages on the user's computer use the chrome action, which works in the Forkwise browser window the app opens, with real tabs that you can open, read and click by element number, much more reliable than clicking pixels (the user signs in there once and it remembers). Set browser to chrome only when you need the user's installed Chrome instead of the built-in one (for example a site that blocks embedded browsers or needs a Google sign-in). You can also download a file from an https link, list running processes, stop a process by id and show the user a notification. For desktop apps use ui_elements to list the buttons and fields of the window in front (Windows), then click their positions. Take a screenshot first to see the screen; click positions are in screenshot pixels. After every click, key press or typing step take a screenshot to check the result before the next step. Destructive actions need extra care: say what you will do first." + own, {
        "action": {"type": "string", "enum": ["info", "screenshot", "windows", "focus", "shell", "open", "click", "move", "drag", "type", "key", "scroll", "wait", "clipboard_get", "clipboard_set", "list_dir", "read_file", "write_file", "wallpaper", "chrome", "ui_elements", "download", "processes", "kill", "notify"]},
        "device": string("Device name or id, if more than one is connected."),
        "command": string("For shell: the command to run."),
        "cwd": string("For shell: working folder."),
        "timeout": integer("For shell: seconds, default 120, max 600."),
        "target": string("For open: an app name (code, notepad, calc, chrome), a path, a URL or a settings link like ms-settings:bluetooth. For focus: part of the window title. For processes: a name to filter by. For kill: the process id."),
        "args": {"type": "array", "items": {"type": "string"}, "description": "For open: extra arguments for the app, like a folder for code."},
        "x": integer("For click, move, drag and scroll: x in screenshot pixels."),
        "y": integer("For click, move, drag and scroll: y in screenshot pixels."),
        "x2": integer("For drag: end x in screenshot pixels."),
        "y2": integer("For drag: end y in screenshot pixels."),
        "button": {"type": "string", "enum": ["left", "right", "middle"]},
        "double": boolean("Double click."),
        "text": string("For type, clipboard_set and notify. For chrome type: the text. For chrome wait: the text to wait for."),
        "keys": string("For key: a key or combination like enter, ctrl+s, alt+tab, win+r."),
        "amount": integer("For scroll: clicks, positive up and negative down. For wait: seconds, at most 30."),
        "path": string("For list_dir, read_file, write_file, wallpaper and download: a path on the user's computer. ~ means their home folder."),
        "content": string("For write_file: the text to write."),
        "source": string("For wallpaper: an image path on the computer or an https link to an image."),
        "op": {"type": "string", "enum": ["start", "tabs", "new_tab", "switch_tab", "close_tab", "goto", "read", "html", "elements", "click", "type", "press", "scroll", "back", "forward", "reload", "eval", "screenshot", "wait"], "description": "For chrome: what to do in the Forkwise browser window on the user's computer. wait pauses until the page shows the text you give (amount is the seconds to wait). new_tab opens a tab with url. elements lists clickable things with numbers (ref); click and type use ref. read returns the page text, html the page source, tabs lists open tabs, switch_tab and close_tab take tab (number or id)."},
        "ref": integer("For chrome click and type: the element number from elements."),
        "tab": string("For chrome: the tab number or id from tabs. Default is the tab you used last."),
        "expression": string("For chrome eval: JavaScript to run in the page. Returns the result."),
        "submit": boolean("For chrome type: press Enter after typing."),
        "browser": {"type": "string", "enum": ["builtin", "mine", "chrome"], "description": "For chrome: builtin is the Forkwise browser window (default). mine is the user's own everyday browser with their sign-ins, through the Forkwise for Chrome extension. chrome is a separate Chrome window with its own Forkwise profile."},
        "url": string("For chrome new_tab, goto and start. For download: the https link of the file."),
        "title": string("For notify: the notification title."),
    }, ["action"])


def my_browser_spec(browser_name):
    return fn("my_browser", "Work in the user's OWN web browser (" + (browser_name or "Chrome") + ") on their computer, through the Forkwise for Chrome extension they connected. "
        "Use it when the user asks you to open, search, read or click something in their browser, or when a task needs a site they are signed in to (email, dashboards, shops, social media). "
        "Your tabs open in a tab group named Forkwise; you can only see and use tabs in that group. The first time you touch a site the user is asked to allow it, so say which site you are opening. "
        "Typical flow: search or new_tab, then read for the page text or elements for numbered clickable items, then click or type with ref, then read again to check. "
        "Use screenshot when the layout matters. Never enter passwords or payment details; ask the user to do that themselves.", {
        "op": {"type": "string", "enum": ["tabs", "search", "new_tab", "goto", "switch_tab", "close_tab", "read", "elements", "click", "type", "press", "scroll", "back", "forward", "reload", "wait", "screenshot"],
               "description": "search opens a Google search for query in a new tab. new_tab opens url in a new tab. goto opens url in the current tab. read returns the page text. elements lists clickable things with numbers (ref). click and type use ref. press sends keys like enter or ctrl+a. scroll uses amount (negative is down). wait waits until text appears (amount = seconds). tabs lists your tabs; switch_tab and close_tab take tab."},
        "query": string("For search: what to search for."),
        "url": string("For new_tab and goto: the address."),
        "tab": string("For switch_tab and close_tab, or to act on another tab: its number or id from tabs."),
        "ref": integer("For click and type: the element number from elements."),
        "text": string("For type: the text to type. For wait: the text to wait for."),
        "submit": boolean("For type: press Enter after typing."),
        "keys": string("For press: keys like enter, tab, escape, ctrl+a."),
        "amount": integer("For scroll: steps (negative scrolls down). For wait: seconds."),
    }, ["op"])
