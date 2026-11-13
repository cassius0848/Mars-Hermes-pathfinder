# 第二轮数据调用核验

| 文件 | 内容和来源 |
| --- | --- |
| `mars-trek-mola-256.tif`、`mola-info.json` | Mars Trek 数值高程样片与服务元数据。范围 77–78°E、18–19°N，256 × 256，Float32。适用于区域概览。 [服务元数据](https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer?f=pjson) · [导出请求](https://trek.nasa.gov/mars/trekarcgis/rest/services/mola128_mola64_merge_90Nto90S_SimpleC_clon0/ImageServer/exportImage?bbox=77%2C18%2C78%2C19&bboxSR=104905&imageSR=104905&size=256%2C256&format=tiff&pixelType=F32&f=image) |
| `meda-518-ats-sample.csv` | Sol 518 已校准气温 CSV 的前 20 条记录。 [校准产品目录](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/sol_0420_0539/sol_0518/) |
| `meda-518-ps-sample.csv` | Sol 518 派生气压 CSV 的前 20 条记录。 [派生产品目录](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0420_0539/sol_0518/) |
| `meda-518-anc-sample.csv`、`meda-518-ancillary.xml` | Sol 518 辅助观测 CSV 的前 20 条记录与对应的完整 PDS4 标签。角度、位置参考框架和时间字段见标签。 [辅助产品](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_derived_env/sol_0420_0539/sol_0518/WE__0518___________DER_ANCILLARY___________P01.CSV) |
| `meda-518-rds.xml` | Sol 518 RDS 光照与尘埃观测的产品标签。 [校准产品目录](https://atmos.nmsu.edu/PDS/data/PDS4/Mars2020/mars2020_meda/data_calibrated_env/sol_0420_0539/sol_0518/) |

CSV 样片保留原表头与记录，用于验证字段。分析整天覆盖、单位和缺测时，使用同版本的完整 CSV 与配套 XML。Sol 518 核对的校准和派生目录均未列出风速产品。 [NASA PDS MEDA](https://pdsatmospheres.nmsu.edu/data_and_services/atmospheres_data/PERSEVERANCE/meda.html)
