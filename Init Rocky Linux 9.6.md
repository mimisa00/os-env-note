# 系統參數調整

### 調整系統參數
```
vi /etc/sysctl.conf
```
```
kernel.msgmax = 65535
kernel.msgmnb = 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 2
net.core.somaxconn = 512
net.core.netdev_max_backlog = 262144
net.ipv4.tcp_synack_retries = 1
net.ipv4.tcp_syn_retries = 1
net.ipv4.tcp_keepalive_time = 30
net.ipv4.tcp_rmem = 4096 87380 16777216
net.core.rmem_max = 16777216
net.ipv4.tcp_wmem = 4096 87380 16777216
net.core.wmem_max = 16777216
```
```
sysctl -p
```

### 時區
```
tzselect
 > Asia
 > Taipai or Taiwan
```

### show 24 Hour date
```
localectl set-locale LC_TIME=C.utf8
```

### 系統時間校正
1. 確認對外網路出口有開放NTP 協議 (UDP 123)

2. 可以透過 chronyc tracking 指令確認是否正常時間中 
> <img width="485" height="213" alt="image" src="https://github.com/user-attachments/assets/dc080a4b-6f5e-4415-ae26-c1b182d77852" />
> <img width="635" height="217" alt="image" src="https://github.com/user-attachments/assets/05e04f9d-6680-4e18-9ab1-1d6953ba01ae" />
或是 `chronyc sources -v` 指令觀察NTP伺服器存取狀況 (有 ^*代表可以正常存取)
> <img width="645" height="257" alt="image" src="https://github.com/user-attachments/assets/1c4be578-533b-4385-946a-ca476388e6e3" />

3. 線輯 /etc/chrony.conf 檔案註解原本的NTP SERVER 加入 新NTP SERVER 後，重啟 Chrony `systemctl restart chronyd`
```
#pool 2.rocky.pool.ntp.org iburst
 pool tock.stdtime.gov.tw  iburst
 pool watch.stdtime.gov.tw iburst
 pool time.stdtime.gov.tw  iburst
 pool clock.stdtime.gov.tw iburst
 pool tick.stdtime.gov.tw  iburst
```
4. 如果一直無法成功同步，可以先手動強制修改時間後再觀察是否能正常同步NTP時間
```
#禁用 NTP
timedatectl set-ntp false
#設定時間：
timedatectl set-time '2024-10-21 19:30:00'
#重新啟用 NTP
timedatectl set-ntp true
#檢查時間：
date
```

### 調整系統顯示語系 (如果有文件語系對齊方便查看)
```
dnf install glibc-langpack-zh
localectl set-locale LANG="zh_TW.utf8"
```

### 關閉 Selinux
```
/etc/selinux/config
````
```
SELINUX=disabled
```
```
reboot -h now
```

### 設定 history 顯示日期時間
```
echo HISTTIMEFORMAT='%F %T ' >> /etc/bashrc
```

# 系統安裝工具

### docker

安裝版本：
docker-ce 　=  3:24.0.2-1.el9
docker-ce-cli = 1:24.0.2-1.el9

https://www.digitalocean.com/community/tutorials/how-to-install-and-use-docker-on-rocky-linux-8
```
sudo dnf check-update
sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
sudo dnf install docker-ce-3:24.0.2-1.el9 docker-ce-cli-1:24.0.2-1.el9 containerd.io docker-buildx-plugin docker-compose-plugin

sudo systemctl enable docker
sudo systemctl start docker
 
#加入操作權限
sudo usermod -aG docker $(whoami)
#加入網路環境
sudo docker network create docker
```
<img width="1569" height="334" alt="image" src="https://github.com/user-attachments/assets/74b2415e-a34f-47d3-b7b9-3d8a89844800" />


### 常用工具
```
sudo dnf install -y wget
sudo dnf install -y rsync
sudo dnf install -y nfs-utils
sudo dnf install -y sshpass
sudo dnf install -y git
sudo dnf install -y bc
sudo dnf install -y nc
```

### 安裝 yml 分析工具
官方文件 : [https://github.com/mikefarah/yq?tab=readme-ov-file](https://github.com/mikefarah/yq?tab=readme-ov-file)
將 [yq](https://github.com/mimisa00/os-env-note/blob/main/yq) 案存放到 `/usr/bin` 目錄下









