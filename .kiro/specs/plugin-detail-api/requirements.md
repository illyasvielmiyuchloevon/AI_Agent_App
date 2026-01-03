# Requirements Document

## Introduction

本需求文档定义了 IDE 插件详情 API 的功能需求。当前插件系统已实现搜索、安装、卸载等基础功能，但缺少获取插件详细信息（如 README、功能列表、changelog、依赖信息等）的能力。这导致插件详情页面无法显示内容。

本功能将完善 IDE 数据交换计划（IDE_Data_Exchange_Plan）中的插件系统部分，实现从 OpenVSX、GitHub Releases 等来源获取插件详情的完整数据链路。

## Glossary

- **Plugin**: 可安装到 IDE 中的扩展包，通常为 VSIX 格式
- **Provider**: 插件来源提供者，如 OpenVSX、GitHub Releases、Official Catalog
- **IDE Bus**: IDE 内部基于 JSON-RPC 2.0 的通信总线
- **Extension Host**: 插件宿主进程，运行插件代码
- **README**: 插件的说明文档，通常为 Markdown 格式
- **Changelog**: 插件的版本更新日志
- **Manifest**: 插件的元数据文件（package.json 或 language-plugin.json）

## Requirements

### Requirement 1

**User Story:** As a user, I want to view detailed information about a plugin before installing it, so that I can make an informed decision about whether to install it.

#### Acceptance Criteria

1. WHEN a user requests plugin details THEN the system SHALL return the plugin's README content in Markdown format
2. WHEN a user requests plugin details THEN the system SHALL return the plugin's feature list and capabilities
3. WHEN a user requests plugin details THEN the system SHALL return the plugin's changelog if available
4. WHEN a user requests plugin details THEN the system SHALL return the plugin's dependencies and requirements
5. IF the plugin details request fails THEN the system SHALL return an error message with the failure reason

### Requirement 2

**User Story:** As a developer, I want the plugin detail API to support multiple providers, so that I can fetch details from different sources consistently.

#### Acceptance Criteria

1. WHEN fetching plugin details from OpenVSX THEN the system SHALL parse the OpenVSX API response and extract README, changelog, and metadata
2. WHEN fetching plugin details from GitHub Releases THEN the system SHALL fetch README from the repository and parse release notes as changelog
3. WHEN fetching plugin details from Official Catalog THEN the system SHALL return pre-defined documentation
4. WHEN a provider does not support certain detail fields THEN the system SHALL return null for those fields without failing

### Requirement 3

**User Story:** As a frontend developer, I want the plugin detail data to be accessible through the IDE Bus, so that I can display it in the UI.

#### Acceptance Criteria

1. WHEN the frontend calls `plugins/getDetail` THEN the IDE Bus SHALL route the request to the plugin manager
2. WHEN the plugin manager returns detail data THEN the IDE Bus SHALL forward the response to the frontend
3. WHEN the detail request times out THEN the system SHALL return a timeout error within 30 seconds
4. THE preload API SHALL expose a `getDetail` method that accepts plugin ID and provider ID

### Requirement 4

**User Story:** As a user, I want to see plugin details in the UI, so that I can understand what the plugin does.

#### Acceptance Criteria

1. WHEN plugin details are loaded THEN the UI SHALL render the README as formatted Markdown
2. WHEN plugin details include a changelog THEN the UI SHALL display it in a separate tab
3. WHEN plugin details include capabilities THEN the UI SHALL display them as a feature list
4. WHEN plugin details are loading THEN the UI SHALL display a loading indicator
5. IF plugin details fail to load THEN the UI SHALL display an error message with retry option

### Requirement 5

**User Story:** As a system architect, I want plugin detail responses to be cached, so that repeated requests do not cause unnecessary network traffic.

#### Acceptance Criteria

1. WHEN plugin details are fetched successfully THEN the system SHALL cache the response for 10 minutes
2. WHEN a cached response exists and is not expired THEN the system SHALL return the cached data without network request
3. WHEN the cache expires THEN the system SHALL fetch fresh data from the provider
4. WHEN the user explicitly requests refresh THEN the system SHALL bypass the cache and fetch fresh data
