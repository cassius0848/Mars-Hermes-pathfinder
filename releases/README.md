# Jezero 网页演示包

打开在线演示即可使用地图选点、路线对比、三维回放和任务卡导出。网页链接无需登录，打开仓库或下载压缩包使用 GitHub 仓库权限。 [在线演示](https://mars-pathfinder-jezero.fengboyuan030509.chatgpt.site/)

[下载离线网页 ZIP](mars-pathfinder-jezero-offline.zip)（约 6.09 MB），解压到任意目录。在解压目录打开终端，运行以下命令。

```text
python -m http.server 8000 --bind 127.0.0.1 --directory mars-pathfinder
```

在浏览器访问 `http://127.0.0.1:8000/`。离线包包含 Jezero 区域图、Hawksbill Gap 和 Neretva Vallis 步行图、任务规划程序和三维渲染所需文件。按选点查询官方接口需要联网。

压缩包 SHA-256 为 `f3ecd74d25cfaedee2962e571c50ad6abe0e282e0907c2d0bc15f1b7e6279f17`。

网页源码位于 [`web`](../web/)，导出脚本位于 [`scripts/build_web.py`](../scripts/build_web.py)。核验记录包含官方数据来源、覆盖范围和路线约束。 [导航验收与复现](../docs/web-navigation-audit.md) · [Neretva 资源说明](../docs/neretva-vallis.md)
