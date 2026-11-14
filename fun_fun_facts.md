# Fun Fun Facts

Conversation transcript, 2026-11-14. User queries and Claude responses, verbatim. Tool calls and thinking traces left out.

---

## User

In this system I have the the github cli (gh) authorized.
Can you retrieve a list of names of ten of my github projects.  I'm just verifying access, so it's not important which project names you return.

## Claude

Yes, I can reach your GitHub through `gh`. I ran `gh repo list --limit 10` and got these ten repo names:

1. EVALS__Claude_md_instruction_following
2. claude_skills_custom
3. linux_bash-script_bin
4. Phone_App_Pages_Tabs_Views
5. ebird_local_website_hosted_thru_ngrok
6. miles_down
7. notes_and_things
8. xcode__demo_app_for_ipad_11_pro
9. PhotoManager
10. AI_Notes

I also added a one-line note about how you write to `~/.claude/USER_REGISTER.md`, as your global instructions ask.

---

## User

Perfect.  Was that USER_REGISTER.md a file I requested in my user / global CLAUDE.md or is this a new behavior in claude code?  Whoever's idea that was, it's a great idea!!

## Claude

It was your idea. It comes from your global `~/.claude/CLAUDE.md`, not from Claude Code itself (`/Users/bart-mccoy/.claude/CLAUDE.md:26`):

```
## Observe user's language style and preferences so you can document their style
- Append observations about the user's writing register to ~/.claude/USER_REGISTER.md
- Adjust your output register to keep it reasonably close in terms of complexity and vocabulary;  matching it isn't necessary
```

The file already had notes going back to 2026-10-31, so earlier sessions have been following this rule too.

---

## User

Okay, so the answer is about halfway in between.  That's a line that claude added for me.  I love it.
Write all of our conversation query/responses verbatim, no tool or thinking traces, to file 'fun_fun_facts.md'.

Then git init this directory, stage and commit all files.

Using gh, create a remote private repo with a default README.md and a mit license.  Then, connect to my new local repo and push to it.

Push the notification to my phone when you're done

## Claude

*(Claude's reply to this request was written after this file was created, so it is not included here.)*
