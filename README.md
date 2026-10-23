# GenVibe

**Your terminal, but it vibes.**

GenVibe is a lightweight AI coding CLI that helps you create projects, update existing code, preview changes, ask questions about your codebase, fix errors, and undo the latest safe update — directly from your terminal.

> Built by **Raj Chandel**

- npm: https://www.npmjs.com/package/genvibe
- GitHub: https://github.com/Rajchandel1
- Instagram: https://www.instagram.com/genz.devloperr/
- Feedback: https://docs.google.com/forms/d/e/1FAIpQLSeMJzm85hRFIdf2fhCHOgzKxfXOvIWxwJVT40UYFGR4g5fyCQ/viewform?usp=publish-editor

---

## Install

Make sure you have **Node.js 20+** and npm installed.

```bash
npm install -g genvibe
```

After installation, use:

```bash
vibe
```

---

## First-time setup

Run:

```bash
vibe chat
```

GenVibe will open Qwen in your browser.

Log in once. If Qwen accepts a disposable email address, you can use:

https://temp-mail.org/en/

GenVibe normally keeps using the same browser session, so you usually do not need to log in every time.

If the session expires or browser data is cleared, Qwen may ask you to log in again.

---

## Quick start

### Create a new project

Run GenVibe inside an empty folder:

```bash
vibe "build me a modern responsive landing page for a SaaS product"
```

### Update an existing project

Open your existing project folder and run:

```bash
vibe update "make the product cards responsive and keep the current design"
```

### Preview a change without modifying files

```bash
vibe dry-run "redesign the hero section"
```

### Ask a question about your project

```bash
vibe ask "where is the product card component and how does it work?"
```

### Open interactive mode

```bash
vibe chat
```

### Undo the latest safe update

```bash
vibe undo
```

### Start a fresh Qwen conversation

```bash
vibe new-chat
```

---

## Commands

| Command | What it does |
|---|---|
| `vibe "your prompt"` | Creates a new project from your prompt |
| `vibe update "<request>"` | Updates an existing project |
| `vibe dry-run "<request>"` | Previews a change without modifying project files |
| `vibe ask "<question>"` | Reads your project and answers questions without changing files |
| `vibe chat` | Opens the interactive GenVibe console |
| `vibe undo` | Restores the latest safe snapshot |
| `vibe new-chat` | Starts a fresh Qwen conversation |

---

## Inside `vibe chat`

Interactive mode supports:

```text
/update <request>
/ask <question>
/dry-run <request>
/fix <error>
/undo
/new-chat
/exit
```

Example:

```text
/update make the navbar sticky and improve mobile spacing
```

Or:

```text
/fix TypeError: Cannot read properties of undefined
```

---

## How to use GenVibe

You do not need complicated prompts.

Just explain what you want in normal language.

For example:

```bash
vibe update "add image URL support to the product form"
```

```bash
vibe update "make this page look more premium but keep the current colors"
```

```bash
vibe dry-run "remove the old header and replace it with a cleaner responsive header"
```

```bash
vibe ask "which file controls the homepage hero?"
```

The more clearly you describe the result you want, the easier it is for GenVibe to help.

---

## Recommended workflow

1. Open your terminal inside the project folder.
2. Tell GenVibe what you want changed.
3. Use `dry-run` first when you want to preview the update.
4. Let GenVibe apply the change.
5. Test the project.
6. Use `vibe undo` if you want to return to the latest safe snapshot.

---

## New project vs existing project

For a brand-new project, run GenVibe inside an **empty folder**.

```bash
mkdir my-project
cd my-project
vibe "build me a modern portfolio website"
```

For an existing project:

```bash
cd my-existing-project
vibe update "add a responsive contact section"
```

---

## Feedback & suggestions

Found a bug?

Have a feature idea?

Want something improved?

Send it here:

**Feedback Form:**  
https://docs.google.com/forms/d/e/1FAIpQLSeMJzm85hRFIdf2fhCHOgzKxfXOvIWxwJVT40UYFGR4g5fyCQ/viewform?usp=publish-editor

---

## Links

**npm**

https://www.npmjs.com/package/genvibe

**GitHub**

https://github.com/Rajchandel1

**Instagram**

https://www.instagram.com/genz.devloperr/

---

## Creator

Built and maintained by **Raj Chandel**.

Instagram: **@genz.devloperr**  
GitHub: **@Rajchandel1**

---

## License

MIT
