"""Plugin catalog. A plugin bundles skills, slash commands and MCP connectors that install together."""

CATEGORIES = ["Code", "Engineering", "Designs & media", "Data", "Reference docs", "Files & documents", "Email & messages", "Marketing", "Research", "Servers & cloud", "AI models & agents"]


def skill(name, description, body):
    return {"name": name, "description": description, "body": body.strip()}


CATALOG = [
    {
        "id": "code-review",
        "name": "Code review",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Code",
        "icon": "git-pull-request",
        "summary": "Reviews diffs like a senior engineer: bugs first, then risk, then style.",
        "description": "Adds a structured review workflow. Forkwise reads the change, runs the tests, ranks findings by severity and proposes exact fixes instead of vague advice.",
        "commands": [{"name": "/review", "description": "Review the current changes"}],
        "skills": [
            skill("code-review", "Review a change set and report ranked findings with fixes", """
When asked to review code:
1. Find the change: git diff against the base branch, or the files the user named.
2. Run the project's tests and linters first, and note failures.
3. Read every changed file fully, plus the callers of changed functions.
4. Report findings ranked: bugs that change behaviour, then security, then performance, then maintainability. Skip pure style unless asked.
5. For each finding give the file and line, a one-line statement of the defect, a concrete failure scenario, and the exact fix as a patch.
6. Say plainly when you found nothing serious. Never invent issues to fill space.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "testing",
        "name": "Test writer",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Engineering",
        "icon": "flask-conical",
        "summary": "Writes and runs real tests for the code in your workspace.",
        "description": "Finds the project's test framework, writes focused tests for the behaviour that matters, runs them and fixes flaky or wrong tests before reporting.",
        "commands": [{"name": "/tests", "description": "Write tests for the current project"}],
        "skills": [
            skill("write-tests", "Write and run tests that pin down real behaviour", """
1. Detect the test runner (pytest, vitest, jest, go test, cargo test) from the project files. Install it only if missing.
2. List the public behaviours of the target code. Write one test per behaviour, including edge cases and one failure path.
3. Prefer real inputs over mocks. Mock only the network, clocks and randomness.
4. Run the suite. If a test fails, decide whether the test or the code is wrong and say which.
5. Report the command to run the tests and the pass count.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "security-audit",
        "name": "Security audit",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Engineering",
        "icon": "shield-check",
        "summary": "Checks a codebase for common vulnerabilities and leaked secrets.",
        "description": "Scans for injection, broken auth, unsafe deserialisation, open redirects, weak crypto and secrets committed to the repository, then writes fixes for what it finds.",
        "commands": [{"name": "/audit", "description": "Run a security audit"}],
        "skills": [
            skill("security-audit", "Audit code for vulnerabilities and fix them", """
Audit defensively and only on the user's own code.
1. Search for secrets: API keys, tokens, private keys, passwords in code and config. Report the file but never print the secret value.
2. Check input handling: SQL built from strings, shell commands from user input, path traversal, template injection.
3. Check auth: session cookies flags, password hashing, missing permission checks on routes.
4. Check dependencies for known vulnerable versions with the ecosystem's audit tool.
5. Rank findings by impact and fix the high ones with minimal patches. Re-run tests afterwards.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "library-docs",
        "name": "Library docs",
        "publisher": "Upstash",
        "verified": True,
        "category": "Reference docs",
        "icon": "book-open",
        "summary": "Up-to-date documentation for thousands of libraries, right inside the chat.",
        "description": "Connects the Context7 MCP server so Forkwise reads current docs and code examples for the exact library version you use, instead of guessing from old training data.",
        "commands": [],
        "skills": [
            skill("use-current-docs", "Look up current library docs before writing code", """
Before writing code that uses a third-party library, call the Context7 tools to resolve the library and fetch its docs for the version in the project's lock file. Prefer examples from those docs over memory. Mention the version you followed.
"""),
        ],
        "connectors": [{"name": "Context7", "url": "https://mcp.context7.com/mcp"}],
    },
    {
        "id": "repo-wiki",
        "name": "Repository wiki",
        "publisher": "Cognition",
        "verified": True,
        "category": "Research",
        "icon": "library",
        "summary": "Ask questions about any public GitHub repository.",
        "description": "Connects the DeepWiki MCP server, which reads public repositories and answers questions about their architecture, APIs and history.",
        "commands": [],
        "skills": [],
        "connectors": [{"name": "DeepWiki", "url": "https://mcp.deepwiki.com/mcp"}],
    },
    {
        "id": "frontend-design",
        "name": "Frontend design",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Designs & media",
        "icon": "palette",
        "summary": "Distinctive, production-grade interfaces instead of generic templates.",
        "description": "Teaches Forkwise a design process: pick a clear visual direction, set type and colour tokens, build responsive components and check the result in the browser at three sizes.",
        "commands": [{"name": "/polish", "description": "Polish the UI of the current page"}],
        "skills": [
            skill("frontend-design", "Design and build polished, responsive interfaces", """
1. Before code, write a two-line design direction: mood, type pairing, colour palette with exact hex values, spacing scale.
2. Define tokens as CSS variables. Never hard-code colours in components.
3. Build mobile first. Check 375px, 768px and 1440px widths with screenshots.
4. Use real copy, not lorem ipsum. Keep one primary action per view.
5. Add hover, focus and pressed states to every control, and short transitions (120 to 200ms).
6. Verify contrast is at least 4.5:1 for body text.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "slides",
        "name": "Slide decks",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Designs & media",
        "icon": "presentation",
        "summary": "Builds clean presentation decks you can present or export to PDF.",
        "description": "Turns an outline or a document into a deck with one idea per slide, consistent layouts, speaker notes and a PDF export.",
        "commands": [{"name": "/deck", "description": "Make a slide deck"}],
        "skills": [
            skill("slide-deck", "Build a presentation deck as HTML with PDF export", """
1. Agree the audience, length and goal in one line before building.
2. Outline first: title, agenda, one idea per slide, closing ask.
3. Build the deck as a single HTML file with 16:9 slides, keyboard navigation and print CSS so it exports to PDF.
4. Use at most two fonts and one accent colour. Charts get real numbers with sources.
5. Write speaker notes under each slide. Export a PDF and give both files.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "data-analyst",
        "name": "Data analyst",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Data",
        "icon": "bar-chart-3",
        "summary": "Cleans spreadsheets, finds trends and builds interactive dashboards.",
        "description": "Loads CSV and Excel files with pandas, documents every cleaning step, computes the numbers in code and delivers charts and a dashboard you can open.",
        "commands": [{"name": "/analyze", "description": "Analyse the attached data"}],
        "skills": [
            skill("data-analysis", "Analyse tabular data with code and deliver charts", """
1. Load the file and print its shape, columns, types and missing values before anything else.
2. Write down each cleaning step and how many rows it changed.
3. Compute every number in code. Never estimate figures in prose.
4. Choose charts by question: trend over time is a line, comparison is a bar, distribution is a histogram.
5. Deliver a short findings list with the numbers, plus an HTML dashboard.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "docs-writer",
        "name": "Docs writer",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Files & documents",
        "icon": "file-text",
        "summary": "READMEs, API references and guides that match the code.",
        "description": "Reads the code before writing, so commands, flags and examples are real. Produces READMEs, API references, changelogs and onboarding guides.",
        "commands": [{"name": "/docs", "description": "Write docs for this project"}],
        "skills": [
            skill("write-docs", "Write documentation that matches the code", """
1. Read the entry points, config and scripts before writing a word.
2. Every command in the docs must be one you ran and saw work.
3. Structure: what it is, quick start in under five steps, configuration table, common tasks, troubleshooting.
4. Use short sentences and second person. No marketing language.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "product-manager",
        "name": "Product manager",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Engineering",
        "icon": "clipboard-list",
        "summary": "PRDs, user stories and launch plans from a rough idea.",
        "description": "Turns an idea into a one-page PRD with goals, non-goals, user stories, acceptance criteria and success metrics, then a launch checklist.",
        "commands": [{"name": "/prd", "description": "Write a product spec"}],
        "skills": [
            skill("write-prd", "Write a one-page product requirements document", """
Sections: problem, who has it, goals, non-goals, user stories with acceptance criteria, success metrics with targets, risks, open questions. Keep it to one page. Ask at most three questions first when the idea is vague.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "seo",
        "name": "SEO",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Marketing",
        "icon": "search",
        "summary": "Technical SEO checks and on-page fixes for your site.",
        "description": "Audits titles, meta descriptions, headings, structured data, sitemap, robots and page speed, then applies the fixes in your code.",
        "commands": [{"name": "/seo", "description": "Audit and fix SEO"}],
        "skills": [
            skill("seo-audit", "Audit a site's SEO and fix issues in code", """
Check each page for: one h1, title under 60 characters, meta description under 155, canonical tag, Open Graph tags, alt text, JSON-LD where it fits. Check sitemap.xml and robots.txt. Measure page weight. Fix issues directly in the code and list what changed.
"""),
        ],
        "connectors": [],
    },
    {
        "id": "deep-research",
        "name": "Deep research",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Research",
        "icon": "telescope",
        "summary": "Multi-source research reports with a citation for every claim.",
        "description": "Plans the questions, searches widely, reads primary sources, cross-checks numbers and writes a structured report with sources.",
        "commands": [{"name": "/research", "description": "Research a topic in depth"}],
        "skills": [
            skill("deep-research", "Research a topic across many sources with citations", """
1. Split the question into three to six sub-questions.
2. Search each one, prefer primary sources, and open the pages rather than trusting snippets.
3. Cross-check every number against a second source and note conflicts.
4. Write the report: summary, findings by sub-question, open questions, sources. Every claim gets a link.
"""),
        ],
        "connectors": [],
    },
]

CATALOG += [
    {
        "id": "microsoft-learn",
        "name": "Microsoft Learn",
        "publisher": "Microsoft",
        "verified": True,
        "category": "Reference docs",
        "icon": "book-open",
        "summary": "Official Microsoft and Azure documentation, searched live.",
        "description": "Connects the Microsoft Learn MCP server so Forkwise reads current docs and code samples for Azure, .NET, Microsoft 365 and more. No account needed.",
        "commands": [],
        "skills": [],
        "connectors": [{"name": "Microsoft Learn", "url": "https://learn.microsoft.com/api/mcp"}],
        "new": True,
    },
    {
        "id": "aws-knowledge",
        "name": "AWS Knowledge",
        "publisher": "Amazon Web Services",
        "verified": True,
        "category": "Servers & cloud",
        "icon": "cloud",
        "summary": "AWS documentation, architecture guidance and regional availability.",
        "description": "Connects the AWS Knowledge MCP server: current AWS docs, What's New posts, Well-Architected guidance and which services run in which region. No account needed.",
        "commands": [],
        "skills": [],
        "connectors": [{"name": "AWS Knowledge", "url": "https://knowledge-mcp.global.api.aws"}],
        "new": True,
    },
    {
        "id": "cloudflare-docs",
        "name": "Cloudflare docs",
        "publisher": "Cloudflare",
        "verified": True,
        "category": "Servers & cloud",
        "icon": "cloud",
        "summary": "Search Cloudflare's documentation for Workers, Pages, R2 and more.",
        "description": "Connects the Cloudflare documentation MCP server so Forkwise answers from current Cloudflare docs when it builds or deploys on Workers, Pages, D1 or R2.",
        "commands": [],
        "skills": [],
        "connectors": [{"name": "Cloudflare docs", "url": "https://docs.mcp.cloudflare.com/mcp"}],
    },
    {
        "id": "hugging-face",
        "name": "Hugging Face",
        "publisher": "Hugging Face",
        "verified": True,
        "category": "AI models & agents",
        "icon": "bot",
        "summary": "Search models, datasets, Spaces and papers on the Hugging Face Hub.",
        "description": "Connects the Hugging Face MCP server so Forkwise can find models, datasets, Spaces and research papers, and read their cards.",
        "commands": [],
        "skills": [],
        "connectors": [{"name": "Hugging Face", "url": "https://huggingface.co/mcp"}],
        "new": True,
    },
    {
        "id": "github",
        "name": "GitHub",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Code",
        "icon": "github",
        "summary": "Repositories, branches, issues and pull requests.",
        "description": "Built into Forkwise. Connect your GitHub account once and Forkwise can clone repositories, push branches and open pull requests for you.",
        "commands": [],
        "skills": [],
        "connectors": [],
        "builtin": "github",
    },
    {
        "id": "google",
        "name": "Google Workspace",
        "publisher": "Forkwise",
        "verified": True,
        "category": "Email & messages",
        "icon": "mail",
        "summary": "Gmail, Calendar, Drive and Sheets.",
        "description": "Built into Forkwise. Connect your Google account to let Forkwise draft emails, read your calendar, and work with Drive files and Sheets.",
        "commands": [],
        "skills": [],
        "connectors": [],
        "builtin": "google",
    },
]

FEATURED = ["code-review", "frontend-design", "library-docs", "github", "google", "deep-research"]
WORKFLOWS = ["testing", "security-audit", "data-analyst", "slides", "docs-writer", "product-manager"]

BY_ID = {item["id"]: item for item in CATALOG}


def kind_label(item):
    if item.get("builtin"):
        return "Built-in integration"
    parts = []
    if item.get("connectors"):
        parts.append("Connector")
    if item.get("commands"):
        parts.append("Commands")
    if item.get("skills"):
        parts.append("Skills" if len(item["skills"]) > 1 else "Skill")
    if len(parts) > 1:
        return ", ".join(parts[:-1]) + " & " + parts[-1].lower()
    return parts[0] if parts else "Plugin"


def public(item, installed=None):
    data = {key: item[key] for key in ("id", "name", "publisher", "verified", "category", "icon", "summary", "description", "commands")}
    data["skills"] = [{"name": entry["name"], "description": entry["description"]} for entry in item.get("skills", [])]
    data["connectors"] = [{"name": entry["name"], "url": entry["url"]} for entry in item.get("connectors", [])]
    data["custom"] = bool(item.get("custom"))
    data["kind"] = kind_label(item)
    data["builtin"] = item.get("builtin") or ""
    data["new"] = bool(item.get("new"))
    data["installed"] = installed is not None
    data["enabled"] = bool(installed and installed.get("enabled"))
    data["installed_at"] = installed.get("installed_at") if installed else 0
    return data
