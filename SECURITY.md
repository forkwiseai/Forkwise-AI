# Security

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Report it privately through GitHub: open the **Security** tab of this repository and choose **Report a vulnerability**. If that is not possible, email **support@forkwiseai.com** with "Security" in the subject.

Include what you found, how to reproduce it and what an attacker could do with it. We will confirm within a few days, keep you posted while we fix it, and credit you in the release notes if you would like.

## Scope

Anything in this repository: the API and agent (`backend/`), the sandbox image and the web app (`frontend/`). Reports about the Forkwise desktop and Android apps and the hosted service at forkwiseai.com are welcome too.

## For self-hosters

- Set a long random `SECRET_KEY`. It encrypts stored secrets and API keys.
- Keep `ALLOW_PRIVATE_PROVIDERS` off on a server other people use. When it is on, users can make the server call addresses on your private network.
- Use `SANDBOX=docker` when more than one person uses your server, so every chat runs in its own container.
