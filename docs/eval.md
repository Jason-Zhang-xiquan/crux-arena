# 评测：竞技场比单模型、多数投票强吗？

`crux eval` 逐题开一场比赛。一场比赛同时给出三组答案，逐题配对比较，对照组不额外花 token：

| 对照组 | 来自 |
|---|---|
| 单模型 | 每位选手的盲答 |
| 多数投票 | 同一批盲答计票（平票按随机打破计期望分） |
| 竞技场 | 主席综合出的冠军答案 |

评测时立场视角一律关闭，盲答就是模型本来的答案。最值得看的是**翻盘**：投票答错、竞技场改对了几题；投票答对、竞技场改错了几题。每次翻盘都能在那场的 `battle-log.md` 里追到谁因为什么说服了谁。

## 用法

```bash
crux eval run 题库.jsonl --team claude,codex,gemini,deepseek          # 只报待跑题数和预计 token，不开打
crux eval run 题库.jsonl --team claude,codex,gemini,deepseek --yes    # 开打；Ctrl+C 中断后再运行会接着跑
crux eval report <评测目录>                                           # 零 token 重新判分，写出 report.md
```

- 默认最多 1 回合（`--rounds`），单场预算用桌面版设置里的值（`--budget`），`--limit N` 只跑前 N 道没跑过的题。
- 评测目录默认是数据目录下的 `evals/<题库文件名>/`：`eval.json`（设置）、`items.jsonl`（题库副本）、`results.jsonl`（每题的盲答原文、冠军答案、用量）、`matches/`（每场完整存档）、`report.md`。
- 同一个目录只能放一组设置（题库、阵容、档位、回合、预算）；换设置请换 `--out`。
- 运行时只存原文，判分在 `report` 里做：改了提取规则，重新 `report` 即可，不用重跑。
- 会消耗你的会员额度。走 Cursor 的调用每次约 1–1.4 万 token（大部分是 Cursor 自带的固定提示），走 Claude Code 约 2–3k。

## 题库格式

一行一个 JSON，`//` 开头的行是注释。

**选择题**（自动判分）：

```json
{"id":"q1","question":"题干","choices":["选项一","选项二","选项三","选项四"],"answer":"B"}
```

提问时会自动加上选项字母和"最后一行写 答案：X"。提取规则依次看"答案：X"、"Answer: X"、"选 X"，最后看结尾；都取不到的按答错计，报告里标成"?"。

**代码审查**（在只读文件夹里埋好 bug）：

```json
{"id":"repo1","kind":"bugs","question":"这个仓库有哪些 bug？按严重程度列出","dir":"bug-repos/repo1","bugs":[
  {"id":"b1","file":"src/auth.ts","keywords":["过期","expiry","expires"]},
  {"id":"b2","keywords":["off-by-one","越界","<="]}]}
```

`dir` 相对题库文件。回答里提到文件名（写了 `file` 时）并命中任一关键词，算找到这个 bug。这是粗判，会漏判也会误判，引用结果前请人工核对。报告会对比冠军答案、每位选手，以及"选手合起来"（任一人找到就算）。

## GPQA

[GPQA](https://huggingface.co/datasets/Idavidrein/gpqa) 是研究生水平的科学选择题。需要你自己在 Hugging Face 上同意使用条款后下载 `gpqa_diamond.csv`，然后：

```bash
crux eval import-gpqa eval/private/gpqa_diamond.csv --limit 20
```

选项顺序按题号哈希固定打乱，每次导入结果相同。**GPQA 要求不要公开题目**：题库文件放在 `eval/private/`（已被 `.gitignore` 忽略），对外只发准确率和翻盘统计，展示用的对局请换成自己出的题。

## 怎么读结果

- 盲答全员一致的题，三种方式几乎不会有差别；竞技场只可能在有分歧的题上拉开差距。
- 几道、几十道题谈不上统计显著。对外请写"N 题里改对 X 题、改错 Y 题"，不要直接说"更准"。
- 门槛（PLAN.md）：竞技场连多数投票都比不过时，先调机制，再扩大评测。
