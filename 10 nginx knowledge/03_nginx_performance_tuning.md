# 透過辨識 nginx session，限制流速及 pool 大小，降低伺服器請求
*此方案僅 nginx 1.17.6 之後才支援*

## 定義在 http block 的位置
```
limit_req_zone $cookie_sessionUserSid zone=zone_user:10m rate=10r/m;
```
|項目                   |說明                                                   |
|-----------------------|------------------------------------------------------|
|limit_req_zone         | 指令，用於定義限速請求的規則                            |
|$cookie_userid | 用 cookie 辨識請求 session 的條件，cookie key userid           |
|zone=zone_user:10m     | 定義此規則名稱為`zone_user`，整體佔用記憶體大小為 10 MB |
|rate=10r/m             | 符合上述條件的 session 每分鐘最多只能請求10次           |

```
limit_req_zone $request_uri zone=rgszone_uri:10m rate=20r/s;
```
|項目              |說明                                                   |
|------------------|------------------------------------------------------|
|limit_req_zone    | 指令，用於定義限速請求的規則                            |
|$request_uri      | 用 URI 辨識請求 session 的條件                         |
|zone=zone_uri:10m | 定義此規則名稱為`zone_uri`，整體佔用記憶體大小為 10 MB   |
|rate=20r/s        | 符合上述條件的 session 每秒最多只能請求20次              |

## 定義在 server block 的位置
```
location /... {
  proxy_pass http://....;
  limit_req zone=zone_uri burst=6000;
  limit_req zone=zone_user burst=10;
  proxy_read_timeout 600s;
}
```
|項目              |說明                                                   |
|------------------|------------------------------------------------------|
|limit_req zone=zone_uri burst=6000    | 使用 zone_uri  規則控管請求，超過6000筆之後的請求就直接拋棄                            |\
|limit_req zone=zone_uri burst=10    | 使用 zone_user  規則控管請求，超過10筆之後的請求就直接拋棄                            |



