# 實用工具

## 如何接回舊 session 接續作業 (原本 session 仍在作業中)
```
##################################################
#
# 如果是透過 opencode serve or opencode web 啟動
#
##################################################
# 連接 Server 並自動接回上一次 Session
opencode attach http://localhost:4096 -c
# 連接 Server 並指定特定 Session ID
opencode attach http://localhost:4096 -s <SESSION_ID>

###############################
#
# 透過 CLI 旗標重開歷史 Session
#
###############################
# 接回最後一次運作的 Session
opencode -c # or opencode --continue
# 接回指定的 Session
opencode -s <SESSION_ID>
# 或
opencode --session <SESSION_ID>

###############################
#
# 在 TUI 介面中即時切換 Session
#
###############################
/sessions  # 選取目標 Session 即可繼續輸出 (需稍微等一下)
```


## opencode 即時權限審批
```
# 當 opencode 在 vm 背景進行開發時，可透過 telegram 遠端操作主 session 進行即時審批
# 需注意資安問題，透過 npx 啟動 bot server 時不要使用預設密碼

# 啟動本地 OpenCode API
opencode serve

# 啟動 bot server
# 依提示輸入 Bot Token 與 User ID 及即完成設定
npx @grinev/opencode-telegram-bot
 
# 一切設定完畢後，即可開始在 telegram 跟 bot 進行對話
# /projects 選擇運作專案
# /sessions 撰擇主對話
```
