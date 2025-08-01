# Nginx 動態域名代理方案

### 為了不在 server {....} 填寫過多的固定的域名，故運用 upstream 特性，讓 server block 的設定簡化

### 實作設定方案如下
```
#### dynumic domains ####
upstream lab00.shaun.com {
   server    192.168.250.150;
   keepalive 300;
}
 
upstream lab01.shaun.com {
   server    192.168.250.150;
   keepalive 300;
}
 
server {
   listen       80;
   server_name  *.shaun.com;
   return 301 https://$host$request_uri;
}
 
server {
    listen       443 ssl http2;
    server_name  *.shaun.com;
    ssl_certificate     /etc/nginx/crt;
    ssl_certificate_key /etc/nginx/key;
    ssl_protocols       TLSv1 TLSv1.1 TLSv1.2;
    ssl_prefer_server_ciphers   on;
    ssl_ciphers 'kEECDH+ECDSA+AES128 kEECDH+ECDSA+AES256 kEECDH+AES128 kEECDH+AES256 kEDH+AES128 kEDH+AES256 DES-CBC3-SHA +SHA !aNULL !eNULL !LOW !kECDH !DSS !MD5 !EXP !PSK !SRP !CAMELLIA !SEED';
    location / {
      proxy_pass         http://$host$request_uri;
      proxy_read_timeout 300s;
      proxy_set_header   Host            $http_host;
      proxy_set_header   X-Real-IP       $remote_addr;
      proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
 
      port_in_redirect   off;
      error_page 502 @auth_faild ;
    }
    ....
}
```
