
### Rocky Linux 9 安裝 Python 3.12
```
dnf install -y python3.12 python3.12-pip python3.12-devel
```

### 安裝完成後驗證版本
```
python3.12 --version
# 應顯示：Python 3.12.x
```

### 啟用 python3.12 專屬虛擬環境
```
# 1. 建立虛擬環境
python3.12 -m venv /root/.venv
# 2. 啟用虛擬環境
source /root/.venv/bin/activate
# 3. 檢查環境中的 Python 版本（此時應自動切換為 3.12）
python --version
```
