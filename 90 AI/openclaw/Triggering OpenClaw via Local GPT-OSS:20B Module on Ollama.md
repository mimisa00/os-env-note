# 安裝在乾淨的VM主機，勿使用自己的工作機
```
git clone https://github.com/openclaw/openclaw.git
cd openclaw
sh docker-setup.sh
```
**安裝時依照本身需求設定，由於此安裝為測試，故使用的 Module 皆以地端 LLM 為主**

**安裝完會產生一組 token 需記錄起來，後續會需要使用此 token 連接 Dashboard**
##

#### 基本配置設定檔 : 由於 OpenClaw 目前有些 Bug 還沒修正，導致安裝在容器內 Claw 無法自動掃描 Ollama 所擁有的 LLM，只能強行設定 ollama 的來源
(因為 Claw 掃描的是安裝在 127.0.0.1 的 ollama ，如果網路環境問題排除就不會有掃描問題)
```
/home/node/.openclaw/openclaw.json
{
  ....
  "models": {
    "providers": {
      "ollama": {
        "apiKey": "ollama-local",
        "baseUrl": "http://192.168.250.159:11434",
        "api": "ollama",
        "models": [
          {
            "id": "gpt-oss:20b",
            "name": "GPT oss 20B",
            "reasoning": false,
            "input": ["text"],
            "cost": { "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0 },
            "contextWindow": 16000,
            "maxTokens": 16000
          }
        ]
      }
    }
  },
  "agents": {
    "defaults": {
      "model": {
        "primary": "gpt-oss:20b"
      },
      "workspace": "/home/node/.openclaw/workspace"
    }
  },
  ...
}
```

### 如果在安裝過程選擇了透過 telegram 作為與 Claw 溝通的窗口，則在 openclaw.json 會出現以下設定 (需先提前建立好 telegram bot)，並且確定 gateway.bin  為 lan
/home/node/.openclaw/openclaw.json
```
{
  ...
  "channels": {
    "telegram": {
      "enabled": true,
      "dmPolicy": "pairing",
      "botToken": "**********", 
      "allowFrom": ["**********"], # 指的是個人 telegram user id，否則任何人都可以呼叫你的 clawbot
      "groupPolicy": "allowlist",
      "streaming": "off"
    }
  },
  ...
  "gateway": {
    "port": 18789,
    "mode": "local",
    "controlUi": {
      "dangerouslyAllowHostHeaderOriginFallback": true,
      "allowedOrigins": ["https://openclaw.iwerp.net","http://192.168.250.17:18789", "http://192.168.250.159:18789"]
    },
    "bind": "lan",
    "auth": {
      "mode": "token",
      "token": "**********"
    },
    ....
  },
}
```

**如果安裝成功後就可以透過 telegram bot 與 Claw 進行溝通如下圖，**
**連接成功後，先下達 /start 指令查看自己的 user id ，然後設定在 channels.telegram.allowFrom 裡面，這樣才能正常跟 Claw 溝通(查看以上設定)**
<img width="778" height="305" alt="image" src="https://github.com/user-attachments/assets/686c8c58-3280-452f-9b66-0ce1dcb1a647" />


## OpenClaw Control WEB UI 授權檢視
如果是透過個人電腦連接 Claw 的 DashBoard，會因為安全問題而無法直接透過 http://x.x.x.x:18789/ 查看 DashBoard，需透過以下授權步驟處理
| #    | 說明 |
| ------------- |:-------------:|
| 1    | 方案1 : 打通 18789 tunnel 到目標主機，然後在個人電腦用 http://localhost:18789/ 開啟瀏覽器     |
| 1-2  | 方案2 : 在安裝 Claw 的主機再建立 Nginx 並處理 SSL 憑證授權，然後再在個人電腦透過 https//domain_name/ 開啟瀏覽器    |
| 以上方案 | 2 擇 1 即可    |
| 2    | 調整 /home/node/.openclaw/openclaw.json 授權可以直接查看控制台的來源，allowedOrigins，例如個人電腦，nginx 來源 IP..等等或是域名   |
| 3    | 當安裝完 moltbot 後雖然會提示 token 值是什麼，但是有可能在反覆安裝過程時，該 token 己改變，故需檢視 .env 檔案 OPENCLAW_GATEWAY_TOKEN 值與 ~/home/node/.openclaw/openclaw.json  gateway.auth.token 的值必需一致，後續的授權操作才不會出錯    |
| 4    | 打開 Claw Dashboard 輸入 token 後點擊 連接  <img width="1918" height="1045" alt="image" src="https://github.com/user-attachments/assets/425ae231-0f4e-4d24-9bea-72aa83164b38" />    |
| 5    | 此時此處說明會改變需要你進入容器內，對來源的瀏覽器進行授權操作  <img width="1899" height="950" alt="image" src="https://github.com/user-attachments/assets/76fe33fd-d413-4dd0-b352-c055d1221c08" /> <img width="513" height="175" alt="image" src="https://github.com/user-attachments/assets/c5a41ff3-294f-4378-8093-74245710d2fb" />   |
| 6    | 回到安裝主機並執行以下指令，條列出目前正在請求檢視 dashbaord 的來源設備 ``` docker exec openclaw-openclaw-gateway-1 node openclaw.mjs devices list ```  <img width="996" height="227" alt="image" src="https://github.com/user-attachments/assets/6d350509-310a-44d2-9801-2cef6d9c8186" />   |
| 7    | # 授權來源設備，下達以下指令 ``` docker exec openclaw-openclaw-gateway-1 node openclaw.mjs devices approve ${Request_Id} ```   <img width="996" height="109" alt="image" src="https://github.com/user-attachments/assets/b4b8a2a8-7f19-49c5-9004-a7d7338d640c" />  |
| 8    |  當授權成功後就可以正常檢視 Claw 的 Dashboard 了 <img width="1904" height="877" alt="image" src="https://github.com/user-attachments/assets/35efce98-4d3e-41c8-aed4-965684ec7bc9" /> |

## 一切就緒後，就可以透過 telegram 或是 dashborad 呼叫安裝在主機上的 Claw ，進行各項測試或是請他製作些什麼東西，如下圖
<img width="1291" height="862" alt="image" src="https://github.com/user-attachments/assets/197a1a5f-88b7-43cf-b605-9408423ce2f9" />
<img width="1912" height="910" alt="image" src="https://github.com/user-attachments/assets/9ecf608b-18ad-41c5-ab1f-8eef4d1561a6" />

