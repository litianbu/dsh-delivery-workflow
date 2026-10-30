# 交付工作流插件（DSH）

这是一个 Host-only 的 DSH 插件：把「飞书需求 → 多项目初始化 → 开发 → 验证 → Jenkins 构建 → Kubernetes 部署」串成一条可审计的交付链路。

插件注册一个模型工具 `delivery`，不依赖 DSH 内部包，宿主只要安装 bundle 即可使用。

## 已实现

- `doctor`：检查配置、项目路径、git/ssh、工作区是否干净、Jenkins 凭据和 kubeconfig。
- `new`：为一个需求创建 run，记录环境、项目列表和统一的 feature 分支。
- `intake`：写入并校验 `requirement.json`、`testcases.json`，强制记录 open questions。
- `phase`：记录每个阶段的通过/失败/阻塞和证据；`intake` 有未回答问题时不接受通过。
- `init`：对单项目/多项目执行 fetch、切基线分支、创建统一 feature 分支、执行 setup；默认拒绝 dirty worktree，支持 dry-run 和 keep-going。
- `verify`：按项目执行配置的检查命令和差异化密钥扫描（私钥、AK、GitHub/OpenAI token、硬编码密码），记录证据。
- `build`：触发 Jenkins 参数化构建并轮询日志解析 tag；也支持手动记录已完成构建。记录前强制检查：
  - 镜像 tag 的格式不做限制（`web-test-7a3c647`、`latest-test`、`test-0123456789ab-42` 都可以），只要求它没有写明一个与目标环境相反的环境；
  - tag 里带 commit 前缀时，该前缀必须等于构建分支 HEAD；
  - feature 分支必须已经合并进构建分支（`git merge-base --is-ancestor`）。
- `deploy`：生成并执行部署命令（`ssh` / `local` / `notebook`），支持 test 直接部署、prod 的 preview/apply 两段式、健康检查、显式 rollback；没有部署主机时返回可直接复制的命令并标记 blocked，`notebook` 模式下返回 `status=manual` 和待粘贴命令。
- `report`：把阶段、项目、构建、部署、测试用例和 open questions 写成 `report.md`。
- `status`：查看最近 runs 或单个 run 的阶段表。

### 开发会话里的需求上下文

`new` 建 run 时会同时开一个开发会话。这个会话打开后是空的——不会有任何自动发送的消息，第一条发言仍然由你自己写。但这条会话的系统提示里已经带上了这次 run 的事实，所以你直接说「帮我分析需求」，模型就知道去哪里读：

- 飞书需求文档地址；
- 已落盘的 `spec/requirement.md`（模型应当直接读它，不必再问你或重新拉文档）；
- 当前分支、参与的每个项目路径，以及各自 test/prod 的 Jenkins job 名。

这些信息来自 run 的 `run.json` 和 `.delivery/config.json`，每次组装提示时重新读取，所以阶段、分支、job 变更后立刻生效。绑定关系单独存在 `~/.config/delivery-workflow/sessions.json`（只有 `{ workspace, runId }`，不含任何凭据），会话 id 到 run 的映射就来自它。

`new` 的返回里带 `contextInjected`，摘要里也会显示 `run context loaded` 或 `WARNING: run context was NOT loaded`。看到这个警告说明这次注入没成功，会话本身仍然可用，只是模型不知道 run 的存在。

注意两点：

- 宿主侧的改动（含本节）要完全退出 DSH 再打开才生效，`Cmd+R` 不够；
- 本功能上线之前建的旧 run 没有绑定记录，重新打开其会话不会注入。新建的需求不受影响。

## 安装

在 DSH 中安装本地 bundle：

```text
plugin_manager(action="install_bundle", target="/Users/runzhili/Desktop/dsh/delivery-workflow")
```

安装后新会话会看到 `delivery` 工具；先调用 `delivery action=doctor` 检查配置是否可读。插件是 Host-only 的，不需要前端构建，也不会新增页面。

## 配置

在一个**工作区目录**下创建 `.delivery/config.json`。工作区可以是单独目录，不需要是某个代码仓库：

```bash
mkdir -p ~/Desktop/biomap-delivery/.delivery
cp /Users/runzhili/Desktop/dsh/delivery-workflow/config.example.json \
   ~/Desktop/biomap-delivery/.delivery/config.json
```

把示例里的 `/absolute/path/to/tongxi-biomap` 换成真实路径，并补齐 Jenkins job 名、部署主机等。项目 `path` 可以是绝对路径，也可以相对工作区。

在 DSH 里把会话工作目录切到该工作区，或在每次调用时传 `workspace`：

```json
{ "action": "doctor", "workspace": "/Users/runzhili/Desktop/biomap-delivery" }
```

### Jenkins 凭据

只从环境变量读取，不写入配置文件：

```bash
export JENKINS_URL="https://jenkins.example.com"
export JENKINS_USER="your-user"
export JENKINS_API_TOKEN="your-api-token"
```

没有凭据时 `build` 会返回手动构建步骤；构建完成后用 `build tag=<tag> buildUrl=<url>` 记录，仍然会做 SHA 和合并检查。

### 部署

`deploy.runner` 支持：

- `ssh`：`ssh -o BatchMode=yes <host> "cd <remotePath> && bash <script> <args>"`。适合跳板机/集群 Notebook；`host` 为空时返回 blocked 和可复制命令。
- `local`：在项目目录直接执行，适合已有 kubeconfig 的机器。
- `notebook`：不代为执行，只输出在 Kubeflow Notebook 终端里可直接粘贴的命令（`cd <remotePath> && bash <script> <args>`），并回显 `notebookUrl`。适合只能通过 Notebook 访问集群、本机没有 kubeconfig 也没有部署机 SSH 权限的场景；此时 `deploy` 返回 `status=manual`，部署阶段标记为 blocked，等待人工执行。

prod 配置支持 `preview` / `apply` 两段式：先跑 preview，人工确认后再传 `apply=true` 和精确的 `confirm` 字符串。

## 一次完整使用

以下参数是工具调用的示意，实际由模型根据会话内容填写。

1. 检查环境

```json
{ "action": "doctor", "workspace": "/Users/runzhili/Desktop/biomap-delivery" }
```

2. 创建 run

```json
{
  "action": "new",
  "workspace": "/Users/runzhili/Desktop/biomap-delivery",
  "requirementId": "TONGXI-123",
  "title": "增加批量导出",
  "projects": ["tongxi-biomap"],
  "env": "test",
  "docUrl": "https://xxx.feishu.cn/docx/..."
}
```

3. 读取飞书文档（由 Agent 使用浏览器工具完成），整理后写入：

```json
{
  "action": "intake",
  "run": "20261027-173000-tongxi-123",
  "requirement": {
    "id": "TONGXI-123",
    "title": "增加批量导出",
    "acceptance": ["P0 用例全部通过", "构建产物包含导出入口"],
    "openQuestions": []
  },
  "testCases": [
    { "id": "TC-001", "module": "导出", "priority": "P0", "steps": ["..."], "expected": "..." }
  ]
}
```

4. 人工确认需求后记录阶段通过：

```json
{
  "action": "phase",
  "run": "20261027-173000-tongxi-123",
  "phase": "intake",
  "status": "passed",
  "note": "用户已确认验收项和测试用例",
  "approver": "李润之"
}
```

5. 初始化项目（先 dry-run）：

```json
{ "action": "init", "run": "20261027-173000-tongxi-123", "dryRun": true }
```

确认命令后去掉 `dryRun`。多项目时默认在第一个失败处停止，传 `keepGoing=true` 继续。

6. 开发完成后验证：

```json
{ "action": "verify", "run": "20261027-173000-tongxi-123" }
```

7. 把 feature 分支合并进 `test`/`main`，然后构建：

```json
{ "action": "build", "run": "20261027-173000-tongxi-123", "waitSeconds": 180 }
```

若 Jenkins 未配置，按返回的手动步骤构建，再记录：

```json
{
  "action": "build",
  "run": "20261027-173000-tongxi-123",
  "tag": "test-0123456789ab-42",
  "buildUrl": "https://jenkins.example.com/job/tongxi-biomap-test/42/"
}
```

8. 部署 test：

```json
{ "action": "deploy", "run": "20261027-173000-tongxi-123", "env": "test", "tag": "test-0123456789ab-42" }
```

prod 先 preview，再 apply：

```json
{ "action": "deploy", "run": "20261027-173000-tongxi-123", "env": "prod", "tag": "prod-0123456789ab-43" }
```

```json
{
  "action": "deploy",
  "run": "20261027-173000-tongxi-123",
  "env": "prod",
  "tag": "prod-0123456789ab-43",
  "apply": true,
  "confirm": "DEPLOY prod tongxi-biomap prod-0123456789ab-43"
}
```

9. 出报告：

```json
{ "action": "report", "run": "20261027-173000-tongxi-123" }
```

## 安全边界

- 不自动 push、merge、rollback；构建前只检查 feature 是否已合并。
- 不执行 `git reset --hard`、`git clean -fd`，不删除用户改动；dirty worktree 默认拒绝初始化。
- 构建产物 tag、SHA、环境、分支必须互相匹配；不匹配直接失败。
- prod 部署必须传入精确的 `confirm` 字符串；prod preview 不需要该确认。
- 健康检查失败只报告失败，不自动回滚。
- 凭据只从环境变量读取；输出统一 redact Authorization/Cookie/token/password。
- `.delivery/` 和 `runs/` 属于工作区状态，不应提交到代码仓库；建议在 `.gitignore` 中忽略 `.delivery/`。

## 状态目录

```text
<workspace>/.delivery/
  config.json
  runs/<run-id>/
    run.json
    events.ndjson
    spec/requirement.json
    spec/testcases.json
    init/<project>.json
    verify/<project>.json
    build.json
    deploy/test.json
    deploy/prod.json
    deploy/prod-preview.json
    report.md
```

会话绑定和 jenkins 凭据单独放在用户配置目录下，不属于任何工作区：

```text
~/.config/delivery-workflow/
  sessions.json   # 会话 id → { workspace, runId }，供开发会话注入需求上下文
  jenkins.json    # Jenkins 凭据（权限 600）
```

## 暂未包含

- 飞书文档读取本身不在插件内：由 Agent 使用 DSH 浏览器工具在用户登录态下打开、滚动、抽取，再调用 `intake`。这样不需要应用凭证，也不把飞书 token 放进插件。
- Kubeflow 适配器只预留了部署配置的接口位置；当前 pilot 的实际部署链路是 Jenkins 构建 + 集群侧 kubectl，未实现 Kubeflow Pipeline 调用。
- 没有 Web UI。v1 先保证工具、状态和安全门可用；后续再按需要加看板。
- 多项目目前共用同一个 feature 分支名，每个项目的 run 状态独立记录；没有实现跨进程项目锁。

## 开发与自测

```bash
cd /Users/runzhili/Desktop/dsh/delivery-workflow
for f in index.js lib/*.js; do node --check "$f"; done
node tests/tool-wrapper.mjs   # 工具注册、execute、render 的封装层
node tests/smoke.mjs          # 完整流程：在 /tmp 建临时 git fixture，跑完所有动作和安全门
```

插件的纯逻辑可以通过 `lib/actions.js` 直接调用（传 `{ workspace }`），不需要启动 DSH：

```bash
node --input-type=module -e "
import { actions } from './lib/actions.js'
const out = await actions.doctor({ workspace: '/tmp/dsh-delivery-workspace' })
console.log(out.summary)
"
```