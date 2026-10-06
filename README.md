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
- 依赖遗漏、窗口冲突、回滚不可执行、关键服务观察窗口不足校验
- 封网日历、共享机柜依赖前序、回滚落点封网、切换目标容量三类约束同单审阅
- 共享机柜前序未完成时后续变更停在待命，前序完成自动恢复
- 批准后窗口或依赖变更：未执行会签作废并重新送审，执行中仅记录影响
- 旧记录缺少三类约束时标记“待补”，补齐前不能放行
- 网络、系统、安全、业务负责人顺序会签
- 执行步骤勾选、实时日志入口、执行偏离记录、完成或回滚判定
- 审批冻结、审计轨迹和复盘 Markdown 导出
- 基于 NgRx 的状态流转与 localStorage 持久化

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
  models/                 领域模型、窗口校验和审阅约束门禁
  pages/                  列表、新建、详情工作区
  services/               HttpClient 数据加载、localStorage、复盘导出
  store/                  NgRx actions、reducer、effects、selectors
```

## 审阅约束

`models/review-constraints.ts` 把三类约束接到同一张审阅单，与窗口重叠共用同一套阻断门禁：

- **封网日历**：窗口命中全网封网或定向封网资源时阻断提交。
- **依赖前序**：本变更依赖了另一在途变更独占的资源（共享机柜）时按依赖排列，前序未完成则后续停在待命，开始执行被挡住；前序完成后自动解除待命。
- **回滚落点 / 切换容量**：回滚落点落在封网资源、或切换目标剩余容量不足时阻断提交并保留现状。

批准时保存窗口与依赖指纹；批准后窗口或依赖发生变化，未执行的会签全部作废并重新送审，执行中的只记录影响、冻结会签不变。旧数据没有 `constraintVersion` 或缺切换目标/回滚落点时显示“待补”，在详情或新建页补齐后才放行。已有 `localStorage` 缓存不含新字段时会显示待补，删除缓存或在页面补齐即可。
