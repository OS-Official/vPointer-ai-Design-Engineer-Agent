# Evals: do changes to the standards make the agents better?

Graded test tasks. Each check can be verified by a script, and most of them run the agent's own linters.

| Case | What it tests |
| --- | --- |
| `arabic-page-fix` | Fixing a broken Arabic page with no brand: zoom, focus, RTL, mobile first, labels, and no example-brand styling leaking in |

Each case folder has `prompt.md` (the task), `case.yaml` (what success looks like), `graders/` (one check per file) and, where needed, `files/` (the input).

To run one:
1. Give each prompt to the agent, once with your change and once without it.
2. Put each run's files in `<iteration>/<case>/<config>/outputs/`, where config is `with_skill` or `without_skill`.
3. Grade:
```
python3 evals/grade.py <iteration-folder>
```

`dea-tool.mjs` lets a script call the agent's design tools, e.g. `node evals/dea-tool.mjs . layout_lint '{"target":"."}'`.

Add your own cases (for example one per brand) as new folders, with a grading function in `grade.py`.
