---
name: crux-mascot
description: Design or edit a Crux Arena pixel mascot — the 24×20 four-pose sprite each AI fighter uses in the arena. Use when the user wants to give a new AI its own look, restyle or recolor one of the built-in mascots (Claude crab, Codex terminal bot, Gemini star, DeepSeek whale…), or asks things like "给我的 llama 画个形象", "把 claude 的螃蟹改成蓝色", "make a mascot for my model".
---

# Crux Arena：画 / 改吉祥物形象

每个选手是一个 24×20 像素、四个姿势（idle / idle2 / atk / hurt）的小人。形象是一份 JSON 像素表，放在数据目录的 `mascots/<编号>.json`。编号和自带角色相同就覆盖它，不同就是新角色。完整格式见仓库里的 `docs/mascots.md`。

## 步骤

1. **弄清要什么**：给哪个 AI（编号），改自带的还是画新的，想要什么样子（代表色、标志性元素、性格）。用户没说清就按这个 AI 最有名的特征来设计，并先告诉用户你的想法。
2. **起稿**：
   - 改自带的：`crux mascot export <编号>`，把程序画的形象导出成像素表，在上面改。
   - 画新的：`crux mascot new <编号> --name 显示名 --color "#主色"`，从模板开始。
   输出里有文件路径，打开它编辑。
3. **画**：编辑 `palette` 和 `poses`。
   - 每个姿势正好 20 行、每行正好 24 个字符；`.` 透明；其他字符必须在 `palette` 里。
   - 全部朝右画（右边的选手会自动镜像），底部留一行空给阴影。
   - 用 2–3 个深浅相近的颜色画身体（亮面 / 主色 / 暗面），加一个深色画眼睛。
   - `idle2` 是 `idle` 的轻微变化（上下动一格、换个小零件），做呼吸动画；`atk` 眯眼、张嘴、亮出武器；`hurt` 眼睛变 `> <` 或 `x x`。
   - 抓住这个 AI 最有名的一个元素，不要照搬官方 logo。
4. **校验**：`crux mascot check <编号>`，按提示修到全部通过。
5. **看效果**：`crux mascot preview <编号>` 生成 PNG（四个姿势横排）。**用你的读图能力打开这张 PNG 自己检查**：轮廓清楚吗、像不像、四个姿势是否连贯；不满意就回到第 3 步改，通常要 2–3 轮。
6. **交付**：把预览图路径给用户，告诉用户在桌面版托盘菜单点"重新加载自定义形象与通道"（或重启桌面版）就能看到。新 AI 要上场还需要一条通道，见 crux-channel skill / `docs/channels.md`。

## 其他

- 不想要了：`crux mascot reset <编号>`（改名为 .bak，恢复自带形象）。
- 看都有哪些：`crux mascot list`。
- 找不到 `crux` 命令：让用户在 Crux Arena 仓库的 `packages/cli` 里运行 `npm link`。
