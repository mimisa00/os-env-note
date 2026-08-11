# 安裝 Nvidia Driver
OS    : Rocky Linux 9.6   
GPU : DataCenter Level NVIDIA L4  
Driver : Data Center Driver for Linux RHEL 9 570.158.01 | Linux 64-bit RHEL 9  
安裝 Nvidia Driver [參考資訊](https://ivonblog.com/posts/rockylinux-install-nvidia-drivers/#1-%E5%AE%89%E8%A3%9Dnvidia%E5%B0%88%E6%9C%89%E9%A9%85%E5%8B%95)

#### STEP 1 : 檢查目前 Nvidia GPU 由什麼驅動 
```
sudo lspci -k | grep -A 2 -i "NVIDIA"
```
沒安裝Nvidia專有驅動前，Linux應該會載入nouveau核心模組，基本上會顯示以下資訊
<img width="499" height="102" alt="image" src="https://github.com/user-attachments/assets/f8ba5d75-56bf-4097-b1ff-b63d5a4f6c9f" />

#### STEP 2：啟用EPEL和CRB套件庫 
```
sudo dnf install epel-release
sudo crb enable
```

#### STEP 3：加入Nvidia官方套件庫，選取RHEL 9版本 
```
#這裡裝的是 rhel 9 這個版本
curver="rhel$(rpm -E %rhel)"
sudo wget -O /etc/yum.repos.d/cuda-$curver.repo \
http://developer.download.nvidia.com/compute/cuda/repos/$curver/$(uname -i)/cuda-$curver.repo
```

#### STEP 4：更新系統後重開機
```
sudo dnf update
 
#重新開機
reboot
```

#### STEP 5 : 安裝編譯依賴套件
```
sudo dnf groupinstall "Development Tools"
sudo dnf install kernel-devel
sudo dnf install dkms
```


#### STEP 6 : 安裝編譯依賴套件
```
# 安裝最新版本驅動
sudo dnf module install nvidia-driver:latest-dkms
 
# 或者解除安裝現有驅動，改裝指定版本的驅動
sudo dnf module list nvidia-driver
sudo dnf erase *nvidia*
sudo dnf module reset nvidia-driver
sudo dnf module install nvidia-driver:560-dkms
```
此時再檢測GPU驅動資訊應該就會看到nvida相關資訊，但是 nouveau 資訊還在 
```
sudo lspci -k | grep -A 2 -i "NVIDIA"
```
<img width="499" height="102" alt="image" src="https://github.com/user-attachments/assets/d5da73ff-35af-4a07-b152-e5e5594f2bc5" />


#### STEP 7 : 編輯GRUB，手動將 nouveau 驅動加入黑名單，然後重開機 (依GCP 提供的OS平台，這邊己經先加了)
```
sudo vim /etc/default/grub
# 在GRUB_CMDLINE_LINUX後面加入：rd.driver.blacklist=nouveau
sudo grub2-mkconfig -o /boot/grub2/grubenv
 
#重新開機
reboot
```

#### STEP 8 : 重開機後確認 Nvidia 驅動版本
```
nvidia-smi
```
<img width="675" height="354" alt="image" src="https://github.com/user-attachments/assets/84203c77-4e27-4399-805a-e435c79618d4" />


#### STEP 9 : 再檢測GPU驅動資訊應該就會看到 nvida 相關資訊，但是 nouveau 資訊仍存在
```
sudo lspci -k | grep -A 2 -i "NVIDIA"
```
<img width="499" height="102" alt="image" src="https://github.com/user-attachments/assets/82bc4133-a270-4056-b1a3-f3e4d0c19094" />



# 安裝 Nvidia CUDA 
[參考資訊]([https://markdownlivepreview.com/](https://ivonblog.com/posts/rockylinux-install-nvidia-drivers/#2-%E5%AE%89%E8%A3%9Dcuda))
#### STEP 1 : 加入Nvidia官方套件庫，選取RHEL 9版本
```
curver="rhel$(rpm -E %rhel)"
sudo wget -O /etc/yum.repos.d/cuda-$curver.repo \
http://developer.download.nvidia.com/compute/cuda/repos/$curver/$(uname -i)/cuda-$curver.repo
```

#### STEP 2 : 安裝最新版CUDA套件
```
sudo dnf install cuda-toolkit
```
<img width="1590" height="480" alt="image" src="https://github.com/user-attachments/assets/fb25ef7e-0b61-4625-bef2-09a1721b4e3d" />

#### STEP3 : 本次安裝的CUDA版本為12.9.1-1，將指令呼叫路徑加入到 PATH (此處先檢查路徑再加，有時不一定跟版本為同名路徑)
```
echo "export PATH=/usr/local/cuda-12.9/bin${PATH:+:${PATH}}" >> ~/.bashrc
source ~/.bashrc
```

#### STEP 4 : 確認CUDA版本
```
nvcc --version
```
應該會顯示如下資訊  
<img width="341" height="117" alt="image" src="https://github.com/user-attachments/assets/5b96c080-e626-4d8f-9ba7-fcd253bb188c" />

# 安裝 Nvidia Container Toolkit 
[參考資訊](https://ivonblog.com/posts/rockylinux-install-nvidia-drivers/#2-%E5%AE%89%E8%A3%9Dcuda)
在 Docker 或 Podman 容器內跑 CUDA 的技術。宿主機必須安裝 Nvidia專有驅動，但不需要安裝CUDA
#### STEP 1 : 安裝 Docker
[Docker 安裝參考資訊](https://docs.docker.com/engine/install/)

#### STEP 2 :  新增 Nvidia 官方套件庫
```
curl -s -L https://nvidia.github.io/libnvidia-container/stable/rpm/nvidia-container-toolkit.repo | \
  sudo tee /etc/yum.repos.d/nvidia-container-toolkit.repo
```

#### STEP 3 : 安裝 Nvidia Container Toolkit
```
sudo dnf install nvidia-container-toolkit
```

> 如果發生GPG金鑰過期問題導致無法順利安裝..參考 [Nvidia Developer](https://developer.nvidia.com/blog/updating-the-cuda-linux-gpg-repository-key/) 解決方案，然後重新安裝 nvidia-container-toolkit
>> <img width="974" height="709" alt="image" src="https://github.com/user-attachments/assets/8a8322e5-0b4a-481a-9b26-b6555d36c8d3" /> 
```
#由於是Rocky Linux 9.6 版本對應的 RHEL 為 rhel9/x86_64
sudo dnf config-manager --add-repo https://developer.download.nvidia.com/compute/cuda/repos/rhel9/x86_64/cuda-rhel9.repo
```

#### STEP 4 : 建立Nvidia的CDI環境定義，並重新啟動 Docker
```
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
sudo nvidia-ctk cdi list
 
sudo systemctl restart docker
```

#### STEP 5 : 測試跑容器，看能否偵測到Nvidia驅動版本
```
sudo docker run --rm --gpus all nvidia/cuda:12.2.0-base-ubi8 nvidia-smi
```
如果成功安裝容器運作時就會顯示 Nvidia 的驅動版本 
<img width="842" height="335" alt="image" src="https://github.com/user-attachments/assets/a271ba89-965a-4840-8c0d-c8771b9f5ea3" />


