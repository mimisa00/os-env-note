# 建立包含 sticky module 功能的 Nginx ，透過 Cookie 達到 session 分流目的
  
  
## 前置作業 
1. 升級 OPENSSL 1.0.2h  https://www.bipmedia.com/blog/tutorial/how-to-install-the-latest-openssl-102h-version-on-centos-67
2. 安裝以下套件
```
git
gcc
perl
pcre-devel
openssl-devel
```
3. 下載 sticky module
```
git clone https://bitbucket.org/nginx-goodies/nginx-sticky-module-ng
```
4. 下載 nginx 原始模組後解壓縮，以下說明以 0.1.16 版本為主
```
wget https://nginx.org/download/nginx-0.1.16.tar.gz
tar zxvf nginx-0.1.16.tar.gz
```

## 安裝作業 
#### 先關閉nginx，避免有nginx 服務正在使用
```
service nginx stop
```

#### 使用Nginx 1.16.1 版本和客制模組
```
ll 
drwxr-xr-x. 9 root root  4.0K Jan 13 14:59 nginx-1.16.1
-rw-r--r--. 1 root root 1009K Jan 13 14:59 nginx-1.16.1.tar.gz
drwxr-xr-x. 5 root root  4.0K Jan 13 14:59 nginx-sticky-module-ng
drwxr-xr-x. 7 root root  4.0K Jan 13 14:59 nginx_upstream_check_module
drwxr-xr-x. 3 root root  4.0K Jan 13 14:59 nginx-upstream-fair
```

#### 進入目錄裡面準備編譯
```
cd nginx-1.16.1
 
drwxr-xr-x. 6 root root 4.0K Jan 13 14:59 auto
-rw-r--r--. 1 root root 290K Jan 13 14:59 CHANGES
-rw-r--r--. 1 root root 442K Jan 13 14:59 CHANGES.ru
drwxr-xr-x. 2 root root 4.0K Jan 13 14:59 conf
-rwxr-xr-x. 1 root root 2.5K Jan 13 14:59 configure
drwxr-xr-x. 4 root root 4.0K Jan 13 14:59 contrib
drwxr-xr-x. 2 root root 4.0K Jan 13 14:59 html
-rw-r--r--. 1 root root 1.4K Jan 13 14:59 LICENSE
-rw-r--r--. 1 root root  337 Jan 13 15:02 Makefile
drwxr-xr-x. 2 root root 4.0K Jan 13 14:59 man
drwxr-xr-x. 4 root root 4.0K Jan 13 15:05 objs
-rw-r--r--. 1 root root   49 Jan 13 14:59 README
drwxr-xr-x. 9 root root 4.0K Jan 13 14:59 src
```

#### 複製現有nginx 運行伺服器的參數
```
nginx -V
 
nginx version: nginx/1.13.8
built by gcc 4.4.7 20120313 (Red Hat 4.4.7-18) (GCC)
built with OpenSSL 1.0.2h  3 May 2016
TLS SNI support enabled
configure arguments: --prefix=/usr/local/nginx --sbin-path=/usr/sbin/nginx --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/log/run/nginx.pid --lock-path=/var/log/lock/subsys/nginx --with-openssl=/usr/local/src/openssl-1.0.2h --with-http_gzip_static_module --with-http_realip_module --with-http_stub_status_module --with-http_ssl_module --with-http_addition_module --with-stream --with-stream_ssl_module --with-http_v2_module --with-threads
```

#### 把nginx標準版本加上sticky模組
```
1. 加上 --add-module=/opt/nginx/nginx-sticky-module-ng
 
2. 開始編譯
./configure --prefix=/usr/local/nginx --sbin-path=/usr/sbin/nginx --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/log/run/nginx.pid --lock-path=/var/log/lock/subsys/nginx --with-openssl=/usr/local/src/openssl-1.0.2h --with-http_gzip_static_module --with-http_realip_module --with-http_stub_status_module --with-http_ssl_module --with-http_addition_module --with-stream --with-stream_ssl_module --with-http_v2_module --with-threads --add-module=/opt/nginx/nginx-sticky-module-ng
 
3. make /usr/local/src/openssl-1.0.2h
 
4. make
 
5. 把客制出來的nginx 檔案覆蓋到原來的nginx的路徑
cp /opt/nginx/nginx-1.16.1/objs/nginx /usr/sbin/
```

#### 檢查版本和參數正確性
```
nginx -V
 
nginx version: nginx/1.16.1
built by gcc 4.4.7 20120313 (Red Hat 4.4.7-18) (GCC)
built with OpenSSL 1.0.2h  3 May 2016
TLS SNI support enabled
configure arguments: --prefix=/usr/local/nginx --sbin-path=/usr/sbin/nginx --add-module=/opt/nginx/nginx-sticky-module-ng --conf-path=/etc/nginx/nginx.conf --error-log-path=/var/log/nginx/error.log --http-log-path=/var/log/nginx/access.log --pid-path=/var/log/run/nginx.pid --lock-path=/var/log/lock/subsys/nginx --with-openssl=/usr/local/src/openssl-1.0.2h --with-http_gzip_static_module --with-http_realip_module --with-http_stub_status_module --with-http_ssl_module --with-http_addition_module --with-stream --with-stream_ssl_module --with-http_v2_module --with-threads
```

#### 檢查nginx 設定正確，無誤後啟動
```
nginx -t
service nginx start
```
