# 数据中心变更窗口与回滚方案审阅平台

面向机房运维、系统、安全和业务负责人的生产变更审阅工作台。工程使用 Angular CLI 独立构建，所有变更记录会写入浏览器 `localStorage`，首次运行通过 `HttpClient` 加载 `public/mock/change-requests.json`。

## 技术栈

- Angular 22 + Angular CLI + TypeScript
- Clarity Angular 18 + Clarity UI
- NgRx Store + Effects
- Angular Router + HttpClient
- RxJS

## 功能

- 变更列表搜索，以及按状态、资源类型和风险等级筛选
- 新建变更方案，维护资源、依赖、执行步骤、回滚步骤、值守人员和窗口
- 依赖关系图与共享资源窗口甘特图
- 封网日历、前序依赖、回滚落点与切换目标容量同一张审阅单校核：
  - 窗口或回滚落点落入封网范围、切换目标容量不足时挡住提交并保留现状
  - 共享机柜变更按依赖排列，前序未完成时后续停在“待命”，前序完成后自动解除
  - 批准后窗口或依赖变化，未执行的会签作废并重新送审；执行中只在审计轨迹记录影响
  - 旧记录缺少三类约束数据时标为“待补”，补齐前不能放行
- 依赖遗漏、窗口冲突、回滚不可执行、关键服务观察窗口不足校验
- 网络、系统、安全、业务负责人顺序会签
- 执行步骤勾选、实时日志入口、执行偏离记录、完成或回滚判定
- 审批冻结、审计轨迹和复盘 Markdown 导出
- 基于 NgRx 的状态流转与 localStorage 持久化

封网日历通过 `public/mock/blackouts.json` 加载（全局封网作用域留空数组即可），并写入独立的 localStorage 键。

## 运行

```bash
npm install
npm start
```

默认开发地址为 `http://localhost:18469`。

生产构建：

```bash
npm run build
```

构建输出位于 `dist/pair-wise-gsb-69/browser`。

## 目录

```text
src/app/
  components/             依赖图、甘特图、校验、审计组件
  models/                 领域模型和校验规则
  pages/                  列表、新建、详情工作区
  services/               HttpClient 数据加载、localStorage、复盘导出
  store/                  NgRx actions、reducer、effects、selectors
```
