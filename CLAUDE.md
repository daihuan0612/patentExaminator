# CLAUDE.md — 专利复审 AI 助手开发指南

## 项目概述

这是一个专利复审 AI 助手，帮助发明专利实质审查员解析审查意见、映射答辩理由、生成复审意见草稿。

## 技术栈

- **前端**: React + TypeScript + Vite
- **后端**: Node.js + Express + TypeScript
- **数据库**: SQLite (服务器端) + IndexedDB (客户端，已迁移)
- **测试**: Vitest (单元/集成) + 自定义 E2E 脚本
- **包管理**: npm workspaces (monorepo)

## 项目结构

```
patent-examiner/
├── client/          # React 前端
├── server/          # Express 后端
├── shared/          # 共享类型和工具
├── tests/           # 测试文件
│   ├── e2e/         # E2E 测试模块（拆分后）
│   ├── e2e-shared/  # E2E 共享工具
│   ├── unit/        # 单元测试
│   ├── integration/ # 集成测试
│   └── evaluation/  # 评估测试
├── samples/         # 测试样本数据
└── docs/            # 文档
```

## 常用命令

### 开发

```bash
# 启动开发服务器（前端 + 后端）
npm run dev

# 仅启动前端
npm run dev:client

# 仅启动后端
npm run dev:server
```

### 测试

```bash
# 运行所有单元测试
npm test

# 运行集成测试
npm run test:integration

# 运行 E2E 测试（Mock 模式）
npm run test:e2e

# 运行 E2E 测试（带质量门禁）
npm run test:e2e:check

# 运行 E2E 测试（Real 模式，需要 API key）
npm run test:e2e:real

# 运行数据库测试
npm run test:db

# 运行所有验证
npm run verify
```

### 代码质量

```bash
# TypeScript 类型检查
npm run typecheck

# ESLint 检查
npm run lint

# 代码格式化
npm run format

# 质量门禁（typecheck + lint）
npm run gate
```

## API Key 读取方式（重要区分）

### 生产 App 运行时（用户使用场景）

生产环境中，API key **不从 `.env` 读取**。用户通过浏览器端的**设置界面**配置 API key，key 存储在服务端的 keyStore 中。

- 用户在 Settings 页面输入 API key → 存储到服务端 keyStore
- AI 调用时从 keyStore 读取 → 发送给 AI Provider
- **不要**在生产代码中用 `process.env.*` 读取任何 API key（GEMINI_KEY、MiMo_KEY、Openrouter_KEY 等）

### 自动测试运行（E2E / Smoke Test）

**仅限测试脚本**使用 `.env` 文件读取 API key。这是为了方便 CI 和本地开发者运行测试，与生产运行无关。

```env
# 以下配置仅用于 tests/e2e.mjs（自动测试）
# 不影响生产 App 的 key 读取逻辑
GEMINI_KEY=your_gemini_key
MiMo_KEY=your_mimo_key
Openrouter_KEY=your_openrouter_key
TAVILY_API_KEY=your_tavily_key
SerpAPI_KEY=your_serp_key
EPO_CONSUMER_KEY=your_epo_key
EPO_CONSUMER_SECRET_KEY=your_epo_secret
```

测试脚本通过 `tests/e2e-shared/env.mjs` 的 `loadEnvFile()` 加载 `.env`，优先级：环境变量 > `.env` 文件。

**关键原则：**
- 生产 App：key 来自用户在 UI 中输入 → keyStore
- 自动测试：key 来自 `.env` 文件或环境变量
- 两者完全隔离，互不影响

## E2E 测试架构

### 测试文件结构

```
tests/
├── e2e.mjs              # 主入口文件
├── e2e-real.mjs         # 旧入口文件（保留兼容）
├── e2e/                 # 拆分后的测试模块
│   ├── index.mjs        # 模块索引
│   ├── health.mjs       # 健康检查
│   ├── mock-agents.mjs  # Mock 模式测试
│   ├── real-agents.mjs  # Real 模式测试
│   ├── schema-validation.mjs  # Schema 验证
│   ├── knowledge.mjs    # 知识库测试
│   └── pipeline.mjs     # 全链路测试
└── e2e-shared/          # 共享工具模块
    ├── index.mjs        # 模块索引
    ├── config.mjs       # 配置管理
    ├── env.mjs          # 环境变量
    ├── http.mjs         # HTTP 工具
    ├── retry.mjs        # 重试逻辑
    ├── schema-validators.mjs  # Schema 验证器
    ├── upload.mjs       # 文件上传
    ├── sample-data.mjs  # 测试数据
    └── test-runner.mjs  # 测试运行器
```

### 运行特定测试

```bash
# 运行所有 Mock 测试
node tests/e2e.mjs --only mock

# 运行 Claim Chart 相关测试
node tests/e2e.mjs --only claimchart

# 运行 Schema 验证测试
node tests/e2e.mjs --only schema

# 运行 Real 模式测试
node tests/e2e.mjs --only real

# 运行全链路测试
node tests/e2e.mjs --only pipeline
```

## 测试数据

测试使用三组标准案例：

- **G1 (LED 散热器)**: `g1-led` - 主要测试案例
- **G2 (锂电池)**: `g2-battery` - 创造性测试
- **G3 (传感器)**: `g3-sensor` - 无对比文件测试

测试数据定义在 `tests/e2e-shared/sample-data.mjs` 中。

## 常见问题

### 1. API Key 找不到

**问题**: 测试报错 "API key not found"

**解决**:
1. 检查 `.env` 文件是否存在
2. 检查 key 名称是否正确（区分大小写）
3. 运行 `node -e "import('./tests/e2e-shared/env.mjs').then(m => m.printEnvSummary())"` 查看配置

### 2. 测试超时

**问题**: Real 模式测试超时

**解决**:
1. 检查网络连接
2. 检查 API key 是否有效
3. 减少 fallback 模型数量

### 3. Schema 验证失败

**问题**: AI 输出不符合预期 Schema

**解决**:
1. 检查 `tests/e2e-shared/schema-validators.mjs` 中的验证规则
2. 检查 AI Provider 是否返回了正确的 JSON
3. 查看 `structureErrors` 字段获取详细信息

## 开发规范

### 代码风格

- 使用 TypeScript 严格模式
- 遵循 ESLint 规则
- 使用 Prettier 格式化

### 提交规范

- 使用 Conventional Commits 格式
- 示例: `feat: 添加新功能`, `fix: 修复 bug`, `test: 添加测试`

### 测试要求

- 新功能必须有对应测试
- 修复 bug 必须有回归测试
- 运行 `npm run verify` 确保所有测试通过

## 相关文档

- [PRD.md](./PRD.md) - 产品需求文档
- [DESIGN.md](./DESIGN.md) - 设计文档
- [backlog.md](./backlog.md) - 功能 backlog
- [DEVELOPMENT_PLAN.md](./DEVELOPMENT_PLAN.md) - 开发计划
