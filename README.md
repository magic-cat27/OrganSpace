# 🧬 OrganSpace — 人体器官交互模拟系统

基于 [Organ-Agents 论文](organ-agents.pdf) 的多智能体架构思想，构建的面向医学教育的简化版人体器官交互模拟系统。

## 核心设计

- **1 个主 Agent（Orchestrator）**：解析用户输入，分解为各器官的影响，协调子 Agent
- **9 个器官子 Agent**：心血管、呼吸、肾脏、肝脏、免疫、神经、血液、凝血、代谢/内分泌
- **3D 可视化**：Three.js 实时展示器官空间关系、连接网络、状态变化
- **WebSocket 实时通信**：前端与后端双向实时交互

## 快速开始

### 1. 设置 API Key

```bash
cp .env.example .env
# 编辑 .env，填入你的 ANTHROPIC_API_KEY
export $(cat .env | xargs)
```

### 2. 安装依赖

```bash
pip install -r backend/requirements.txt
```

### 3. 启动服务

```bash
cd backend
python server.py
```

服务默认运行在 http://localhost:8765

### 4. 使用

浏览器打开 http://localhost:8765，输入医学场景并观察模拟结果。

## 项目结构

```
OrganSpace/
├── backend/
│   ├── server.py              # FastAPI + WebSocket
│   ├── config.py              # 配置
│   ├── agents/
│   │   ├── base.py            # 器官 Agent 基类
│   │   ├── orchestrator.py    # 主协调 Agent
│   │   └── organs/            # 9 个器官子 Agent
│   └── models/
│       ├── state.py           # 器官状态模型
│       └── graph.py           # 器官连接图
├── frontend/
│   ├── index.html             # 主页面
│   ├── css/style.css          # 样式
│   └── js/
│       ├── app.js             # 主逻辑 + WebSocket
│       ├── scene.js           # Three.js 3D 场景
│       ├── organs.js          # 器官 3D 定义
│       └── chat.js            # 聊天面板
└── organ-agents.pdf           # 参考论文
```

## 与论文的简化对比

| 论文 | 本项目 |
|---|---|
| 15k 患者数据训练 | LLM zero-shot 医学知识 |
| PPO 强化学习协调 | 图传播 + LLM 协调 |
| 125 个临床变量 | 每器官 5-10 个关键变量 |
| 12 小时时序预测 | 单步状态推演 |
| 残差补偿 Agent | 不实现 |
