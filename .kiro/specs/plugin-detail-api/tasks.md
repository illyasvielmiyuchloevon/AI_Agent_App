# Implementation Plan

- [x] 1. 实现 DetailCache 缓存模块 (Main 进程)





  - [x] 1.1 创建 `electron/main/lsp/plugins/DetailCache.js`


    - 实现内存缓存，支持 TTL（默认 10 分钟）
    - 实现 get/set/invalidate/clear 方法
    - _Requirements: 5.1, 5.2, 5.3_
  - [x] 1.2 编写 DetailCache 属性测试


    - **Property 4: Cache Lifecycle Correctness**
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4**

- [x] 2. 扩展 OpenVsxProvider 支持 getDetail (Main 进程)





  - [x] 2.1 在 `OpenVsxProvider.js` 中添加 `getDetail` 方法


    - 调用 OpenVSX API 获取完整扩展信息（含 readme、changelog）
    - 规范化响应为 PluginDetail 结构
    - _Requirements: 2.1, 2.4_
  - [x] 2.2 编写 Provider 规范化属性测试


    - **Property 2: Provider Response Normalization**
    - **Validates: Requirements 2.1, 2.2, 2.4**

- [x] 3. 扩展 LanguagePluginManager 支持 getDetail (Main 进程)






  - [x] 3.1 在 `LanguagePluginManager.js` 中添加 `getDetail` 方法

    - 集成 DetailCache
    - 支持 forceRefresh 参数
    - 处理 Provider 不存在的情况
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 5.4_

  - [x] 3.2 编写响应结构属性测试

    - **Property 1: Detail Response Structure Completeness**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4**

- [x] 4. Checkpoint - 确保 Main 进程测试通过





  - Ensure all tests pass, ask the user if questions arise.

- [-] 5. 注册 IDE Bus 方法 `plugins/getDetail` (Main 进程)



  - [x] 5.1 在 `registerIdeBus.js` 中添加 `plugins/getDetail` 处理器


    - 路由请求到 PluginManager.getDetail
    - 返回标准响应格式 { ok, detail, error, cached }
    - _Requirements: 3.1, 3.2, 3.3_

  - [x] 5.2 编写 IPC 完整性属性测试

    - **Property 5: IPC Request-Response Integrity**
    - **Validates: Requirements 3.1, 3.2**
  - [ ] 5.3 编写错误响应属性测试


    - **Property 3: Error Response Consistency**
    - **Validates: Requirements 1.5**

- [ ] 6. 扩展 Preload API (桥接层)
  - [ ] 6.1 在 `preload.js` 的 plugins 对象中添加 `getDetail` 方法
    - 使用 tryBus 调用 `plugins/getDetail`
    - _Requirements: 3.4_

- [ ] 7. 扩展 pluginsService (Renderer 进程)
  - [ ] 7.1 在 `frontend/src/workbench/services/pluginsService.js` 中添加 `getDetail` 方法
    - 调用 preload API
    - 处理加载状态和错误
    - _Requirements: 3.4_

- [ ] 8. Checkpoint - 确保数据链路测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. 实现插件详情 UI 组件 (Renderer 进程)
  - [ ] 9.1 创建 `PluginDetailPanel.jsx` 组件
    - 显示加载状态
    - 渲染 README (Markdown)
    - 显示 changelog 标签页
    - 显示功能列表
    - 显示错误信息和重试按钮
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_
  - [ ] 9.2 集成到现有插件管理页面
    - 在 LspSettingsPage 中添加详情查看入口
    - _Requirements: 4.1_

- [ ] 10. Final Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.
