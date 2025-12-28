# 🎥 Video Download Helper - 安装指南

## 快速安装

### 方法一：直接加载（推荐开发测试）

1. **下载源码**
   ```bash
   # 如果是git仓库
   git clone <repository-url>
   cd Video_Download_Helper
   
   # 或者直接下载解压到本地文件夹
   ```

2. **验证构建**
   ```bash
   # 在项目目录下运行（可选）
   chmod +x build.sh
   ./build.sh
   ```

3. **加载到Chrome**
   - 打开 Chrome 浏览器
   - 访问 `chrome://extensions/`
   - 打开右上角的 "开发者模式" 开关
   - 点击 "加载已解压的扩展程序"
   - 选择 `Video_Download_Helper` 文件夹
   - 扩展程序将自动加载

### 方法二：打包安装

1. **创建安装包**
   ```bash
   ./build.sh --package
   ```

2. **安装.zip包**
   - 将生成的 `video-download-helper.zip` 发送给需要的用户
   - 用户解压后按照方法一的步骤3-6操作

## 安装验证

### 1. 检查扩展是否正常加载
- 在 `chrome://extensions/` 页面中查看扩展状态
- 确保没有错误信息
- 图标应该显示在Chrome工具栏中

### 2. 测试基本功能
- 打开项目中的 `test.html` 文件
- 点击Chrome工具栏中的扩展图标
- 应该能看到检测到的测试视频

### 3. 测试实际网站
- 访问任何包含视频的网站（除了YouTube）
- 点击扩展图标
- 查看是否检测到视频文件

## 常见安装问题

### 问题1: 扩展无法加载
**症状**: Chrome提示"无法加载扩展程序"
**解决方案**:
```bash
# 检查manifest.json是否有效
node -pe "JSON.parse(require('fs').readFileSync('manifest.json', 'utf8'))"

# 检查必需文件是否存在
ls -la icons/
ls -la js/
ls -la css/
```

### 问题2: 图标显示异常
**症状**: 扩展图标不显示或显示为默认图标
**解决方案**:
```bash
# 重新生成图标
open icons/create_icons.html
# 在浏览器中点击"Generate Icons"按钮
# 下载所有图标文件到icons/文件夹
```

### 问题3: 无法检测视频
**症状**: 扩展加载正常但不检测视频
**解决方案**:
1. 确保不是在YouTube网站上测试
2. 打开浏览器开发者工具（F12）查看控制台错误
3. 尝试刷新页面后再点击扩展图标
4. 使用项目中的 `test.html` 进行测试

### 问题4: 下载功能不工作
**症状**: 能检测视频但无法下载
**解决方案**:
1. 检查Chrome下载权限设置
2. 确保Chrome允许自动下载
3. 查看是否被防病毒软件阻止

## 权限说明

扩展请求的权限及其用途：

| 权限 | 用途 | 必需性 |
|-----|------|-------|
| `activeTab` | 访问当前标签页内容以检测视频 | 必需 |
| `downloads` | 管理下载任务 | 必需 |
| `storage` | 保存设置和统计信息 | 必需 |
| `scripting` | 在网页中注入检测脚本 | 必需 |
| `webRequest` | 监控网络请求以检测视频流 | 必需 |
| `declarativeNetRequest` | 阻止YouTube相关请求 | 必需 |

## 卸载指南

### 完全卸载扩展
1. 访问 `chrome://extensions/`
2. 找到 "Video Download Helper"
3. 点击"删除"按钮
4. 确认删除

### 清理数据（可选）
```javascript
// 在任何网页的控制台中执行以下代码来清除存储的数据
chrome.storage.local.clear();
chrome.storage.sync.clear();
```

## 技术支持

### 获取帮助
1. **查看日志**: 打开Chrome DevTools → Console标签页
2. **重现问题**: 按照具体步骤重现问题
3. **收集信息**: 
   - Chrome版本
   - 操作系统
   - 扩展版本
   - 具体错误信息

### 调试模式
```bash
# 启用详细日志（开发模式）
# 修改 js/background.js 中的 DEBUG 变量为 true
```

### 常用调试命令
```bash
# 检查扩展文件完整性
./build.sh

# 重新打包
./build.sh --package

# 查看扩展结构
find . -name "*.js" -o -name "*.html" -o -name "*.json" | sort
```

## 更新指南

### 更新扩展
1. 下载新版本源码
2. 在 `chrome://extensions/` 中点击扩展的"刷新"图标
3. 或者重新加载整个扩展

### 保留数据
扩展更新会自动保留用户设置和下载统计数据。

---

## 🚀 安装成功！

如果你看到扩展图标出现在Chrome工具栏中，并且能够成功检测视频，那么恭喜你！扩展已经安装成功。

**下一步**：
- 访问包含视频的网站测试功能
- 查看README.md了解详细使用说明
- 如有问题请查看上方的问题排查指南
