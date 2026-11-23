# Contributing to Forkwise

Thanks for helping. Forkwise is built in the open and every fix, skill, tool, doc page and translation makes it better for everyone.

## Ways to help

- **Report a bug.** Open an [issue](https://github.com/hoomanyyy/Forkwise-AI/issues/new/choose) with the steps, what you expected and what happened. Screenshots and the model you used help a lot.
- **Suggest a feature.** Open an issue first so we can agree on the shape before you write code.
- **Write a skill.** Skills are Markdown playbooks in [`backend/app/agent/skills/`](backend/app/agent/skills). A good skill is a short, opinionated method a senior engineer would follow, with a clear "use this when" line at the top.
- **Improve the docs.** The docs live in [`frontend/src/content/docs.js`](frontend/src/content/docs.js) and are published at [forkwiseai.com/docs](https://forkwiseai.com/docs).
- **Star the repo.** It helps more people find Forkwise.

## Set up

You need Python 3.11+, Node.js 20+ and a key from any OpenAI-compatible model provider.

```bash
git clone https://github.com/<you>/Forkwise-AI forkwise
cd forkwise/backend
cp .env.example .env        # SANDBOX=local, DATA_DIR=./data, API_URL=http://localhost:5000, LLM_* for your provider
pip install -r requirements.txt
./run.sh                    # API on http://localhost:5000

cd ../frontend
npm install
npm run dev                 # web app on http://localhost:5173 (calls to /api go to the API)
```

## Before you open a pull request

- `cd frontend && npm run build` passes.
- `cd backend && python -m compileall -q app` passes, and you tried your change against a running server.
- You clicked through what you changed. For anything visible, add a screenshot to the pull request.

## Style

- Keep pull requests small and about one thing.
- Match the code around you: plain functions, clear names, no new dependency unless it pays for itself.
- Write user-facing text in short, plain sentences. Say what happens, not how clever it is.
- Never commit secrets, `.env` files, databases or anything from `data/`.

## Commit messages

Say what changed and why, in the present tense: `Keep menus in place while the page scrolls`.

## License

By contributing you agree that your contribution is licensed under the [GNU AGPL-3.0](LICENSE), and that the Forkwise maintainers may also include it in the Forkwise apps and offer it under other licenses.
