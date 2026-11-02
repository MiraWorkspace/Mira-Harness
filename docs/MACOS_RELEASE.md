# macOS 签名与发布

`npm run desktop:build` 生成完整 ad-hoc 签名的 arm64 本机测试 DMG，并验证应用资源签名和 `com.tuyn53.mira` 身份。无需 Apple 开发者证书。它不带 Apple 公证，不能作为已完成正式签名的公开发行包。

原来的打包命令在没有证书时会跳过签名，留下标识为 Electron、未绑定 Info.plist 和资源的链接器签名。Electron 43 的 macOS 通知使用 UNUserNotificationCenter，需要有效应用签名；仅修改 Info.plist 的 appId 或打开系统通知列表不能修复这个问题。

## 本机通知验证

1. 运行 `npm run desktop:build`，确认输出“签名校验通过”。
2. 退出旧 Mira，将新 DMG 中的 Mira 替换安装到 `/Applications`，从该位置启动。
3. 打开 Mira → 设置 → 常规。Electron 初始化通知中心时会请求系统授权，若出现授权弹窗，选择允许。
4. 打开系统设置 → 通知，检查 Mira 是否出现。临时将轮次完成通知设为“始终”，完成一轮回复验证通知；验证后恢复自己的提醒偏好。

不需要清除 Mira 数据、重置系统通知数据库或修改系统安全设置。ad-hoc 签名后的通知注册与投递仍需在实际安装包中验收；命令验签成功不等于通知验收通过。

## 对外正式发布

1. 加入 [Apple Developer Program](https://developer.apple.com/programs/)。
2. 在 Xcode → Settings → Accounts 登录开发者账号，选择团队 → Manage Certificates，创建 **Developer ID Application** 证书。若通过开发者网站创建证书，需使用本机生成的 CSR，并将签发的证书导入保存对应私钥的钥匙串。
3. 运行以下只读命令，确认有有效的 `Developer ID Application: ...` 身份：

   ```sh
   security find-identity -v -p codesigning
   ```

4. 为 Apple ID 创建[应用专用密码](https://support.apple.com/102654)，在终端交互保存公证凭据：

   ```sh
   xcrun notarytool store-credentials mira-notary
   ```

   按提示输入 Apple ID、Team ID 和应用专用密码。凭据保存在本机钥匙串，不要放进仓库、聊天消息或构建日志。

5. 构建正式安装包：

   ```sh
   APPLE_KEYCHAIN_PROFILE=mira-notary npm run desktop:release
   ```

   此命令使用 Developer ID 签名、Hardened Runtime 和 Apple 公证，并在生成 DMG 前验证资源签名、签名身份和附加的公证票据。缺少证书或公证配置时直接失败，不会静默生成未签名的发行包。存在多个发布证书时，可用 `CSC_NAME` 选择身份；CI 可通过 electron-builder 的 `CSC_LINK` / `CSC_KEY_PASSWORD` 导入证书。

6. 在安装后的实际路径验收系统信任与通知：

   ```sh
   codesign --verify --deep --strict /Applications/Mira.app
   spctl --assess --type execute --verbose=2 /Applications/Mira.app
   xcrun stapler validate /Applications/Mira.app
   ```

   然后检查授权弹窗、系统通知列表、通知显示和点击后返回对应会话。不能用单元测试或验签替代这些验收。
