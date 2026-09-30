# Explaining

> **The reader's new model is the deliverable, not the accuracy of the sentence.**

A wrong explanation that the reader accepts is the silent violation this file exists for. It reads
well, it is technically defensible, they nod, and they walk away holding a model that will cost
them an afternoon later. Nothing in the reply signals the gap — which is why this is a rule and not
a style preference.

- **Answer the question asked, in the first line.** `Yes.` then the detail. Context before the
  answer makes the reader hunt for it, and they guess while hunting — usually wrong.
- **Lead with the plain version; add the precision after.** "A partition is a slice of a big table"
  earns the right to say `PARTITION BY LIST`. The reverse order teaches nothing twice.
- **Keep their words, including the wrong ones.** Somebody who says "dead tables" gets an answer
  about dead tables, and the real name arrives beside it rather than instead of it. Swapping
  vocabulary mid-explanation costs them the thread and buys precision they cannot yet use. When
  they ask you to keep a word, keep it in every later answer too.
- **Correct the model, not the wording.** *"Close, but not quite it"*, then the one distinction
  that matters — `dead` means unreachable, not empty. A correction that only fixes the term leaves
  the misunderstanding intact and adds a vocabulary lesson on top.
- **State the problem before the solution.** The outbox is unexplainable until the reader can see
  the two writes coming apart. A mechanism described before the failure it prevents is a list of
  moving parts.
- **Contrast is what makes a decision land.** Why the outbox has no tenant level is one sentence
  once `messages` is beside it: one is read for a single tenant, the other for everybody at once.
- **Show the real thing.** Print the six partition names out of the running database rather than
  describing the naming scheme. A reader checks a real name against what they already believe;
  they cannot check a description.
- **Anchor each new idea to one they already hold.** *"That is the exact problem that broke the
  tests"* costs six words and saves the whole explanation.
- **Numbers go in a small table or on their own line** — never threaded through a sentence, and
  only when they change what the reader does.
- **One idea per sentence.** Short is not clipped: a sentence beats a label and a colon, and a new
  sentence beats a semicolon.

**Verify before you explain, every time.** Read the source, run the query, count the rows. An
explanation assembled from memory is where a confident falsehood gets minted, and the reader has no
way to catch it. **When asked whether something is done, re-measure rather than recall** — the
answer may have changed since you last looked, including because of something you did.

**This is not a rule to write less.** Cutting a sentence the reader needed is the same failure from
the other side. Cut history, restatements, and anything the reader can already do without.

---

**The argument.**
[`docs/opinions/comments.md`](../../opinions/comments.md) — the same test one level down: a comment
survives when it stops the next reader misreading the line under it.

When this file and `docs/opinions/` disagree, **`docs/opinions/` wins and this file is stale;
say so.**
