# 变更智达：生产变更智能下发助手（公开演示版）

本仓库是本地 Web 原型，用虚构订单、变更通知单、生产计划、班组和演示规则展示变更分析与人工审批流程。不连接真实生产系统，不执行真实下发；模型建议和演示规则不能作为生产依据。

公开版没有包含原始业务资料、待复核脱敏资料、真实案例库、浏览器缓存、运行记录或 API 密钥。历史案例处理及评测相关代码保留，但本仓库不提供原始数据或评测结果；不要把演示结果当成实际业务准确率。

## 本地启动

环境：Node.js 20 或更新版本，Python 3 和 `pip`。

```bash
python -m pip install -r requirements.txt
node prototype/server.mjs
```

在浏览器打开 <http://127.0.0.1:4173>。服务只监听本机。可通过环境变量 `PORT` 更改端口。演示页面、订单与 PDF 预览无需配置模型；AI 分析与对话需要另外配置兼容 OpenAI Chat Completions 接口并支持工具调用的模型服务。

### 配置模型

把 `prototype/.env.example` 复制为 `prototype/.env.local`，在本机填写服务商地址、模型名和密钥，然后重启服务。`MODEL_BASE_URL` 应为兼容接口的基础地址（通常以 `/v1` 结尾）；不要提交 `.env.local`。默认演示 PDF 含文本层；只有处理扫描件且模型支持图片输入时才将 `MODEL_VISION` 设为 `1`。

调用模型时，分析所需的变更内容、候选班组和检索资料会发送到所配置的模型服务。使用真实数据前，需自行确认数据使用权限及服务商的数据处理方式。

## 目录

- `prototype/server.mjs`：本地服务、模拟订单、模型调用和审批流程。
- `prototype/public/`：Web 页面和样式。
- `prototype/lib/`：生产计划检查、证据校验和 PDF 工具。
- `prototype/data/production-plan.json`：虚构的演示生产计划。
- `prototype/documents/`：三份虚构演示通知单；可运行 `python prototype/scripts/create_demo_pdf.py` 重新生成。
- `prototype/knowledge/`：虚构的演示班组职责与分发规则。
- `prototype/scripts/`：演示生成、历史数据处理和评测脚本；历史脚本需要自行准备符合格式且有权使用的数据，不包含数据本身。脚本对部分历史状态的标签映射是特定假设，不能直接套用于其他业务数据。
- `prototype/share-bridge/`：可选的本机转发代码；默认没有配置公网来源。

## 验证

```bash
node prototype/_qa/evidence-test.mjs
node prototype/_qa/document-citation-guard-test.mjs
node prototype/_qa/public-demo-test.mjs
node prototype/_qa/public-agent-test.mjs
```

公开版仅用于功能演示，不声称模型分析已通过真实业务验收。实际部署前应针对具体数据、权限、模型和安全边界重新测试。
