# Offline workflow stage

Airflow is not required for the local streaming MVP. `../benchmarks/encode.py` produces structured JSON from actual encoding runs and can become an Airflow task once benchmark inputs and object storage exist. Future DAG: fetch clip → encode codec variants → measure VMAF/PSNR → compare → persist report. Airflow must not carry live media.
