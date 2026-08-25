# 實用工具

## opencode 即時權限審批
```
# 當 opencode 在 vm 背景進行開發時，可透過 telegram 遠端操作主 session 進行即時審批
# 需注意資安問題，啟動 bot 時不要使用預設密碼

# 啟動本地 OpenCode API
opencode serve
 
# 依提示輸入 Bot Token 與 User ID 及即完成設定
npx @grinev/opencode-telegram-bot
 
# 一切設定完畢後，即可開始在 telegram 跟 bot 進行對話
# /projects 選擇運作專案
# /sessions 撰擇主對話
```
