# prediction-latency-observability Specification

## Purpose

Client-observed latency visibility for the prediction and embedding pipeline. The
workers currently emit no metrics, so the only latency signal is the gateway's
opaque `bullmq_job_total_duration_seconds`, which blends queue wait, embedding
inference, the prediction model fan-out, S3 I/O, and decode into a single number.
This capability makes per-model and per-job inference latency observable from the
worker side (successes and failures, including time-to-failure on dropped or
timed-out Triton calls), surfaces end-to-end request latency for embedding and for
the full prediction flow (embedding prerequisite + all models) at the gateway, and
exposes a `/metrics` endpoint on each worker for a scraping agent to collect and
remote-write to the metrics backend.

## Requirements

### Requirement: Per-model Triton call latency is measured

The prediction and embedding workers SHALL record the duration of each Triton inference call as a histogram `triton_model_infer_duration_seconds` labeled by `model` and `status`. The measurement SHALL be client-observed (around the gRPC call) so it captures network and gRPC overhead that Triton's server-side metrics do not see.

#### Scenario: Successful call is timed per model

- **WHEN** a worker completes a Triton `modelInfer` call for a given model
- **THEN** the call's wall-clock duration is observed into `triton_model_infer_duration_seconds` with that model's label and `status="success"`

#### Scenario: Per-model labels distinguish the fan-out

- **WHEN** a prediction job fans out to its multiple models
- **THEN** each model's call is observed under its own `model` label, so a single slow or failing model is distinguishable from the others

### Requirement: Failure-path latency is measured

The workers SHALL record latency for Triton calls that fail (dropped connection, timeout, or error), labeled with a non-success `status`, so time-to-failure is observable and not silently dropped.

#### Scenario: Dropped/timed-out call records time-to-failure

- **WHEN** a Triton call fails (e.g. UNAVAILABLE / connection dropped or deadline exceeded)
- **THEN** the elapsed time until failure is observed into `triton_model_infer_duration_seconds` with a non-success `status` label (e.g. the error class)

#### Scenario: All-models-failed prediction still yields per-model timings

- **WHEN** every model in a prediction job's fan-out fails
- **THEN** each failed call contributes a failure-labeled latency observation, so the storm is characterizable rather than invisible

### Requirement: Per-job inference latency is measured

The workers SHALL record per-job wall-clock latency: `prediction_job_duration_seconds` for prediction jobs (covering the full fan-out) and `embedding_job_duration_seconds` for embedding jobs, each labeled by `status` (success/failure).

#### Scenario: Prediction fan-out wall-clock is recorded

- **WHEN** a prediction job finishes processing (success or failure)
- **THEN** its end-to-end worker processing duration is observed into `prediction_job_duration_seconds` with the corresponding `status`

#### Scenario: Embedding job wall-clock is recorded

- **WHEN** an embedding job finishes processing
- **THEN** its duration is observed into `embedding_job_duration_seconds` with the corresponding `status`

### Requirement: End-to-end request latency is measured

The system SHALL measure end-to-end request latency (user-perceived, including queue wait) at the gateway: embedding request latency (submission to embedding result) and prediction request latency covering the full flow of embedding plus all prediction models (submission to final prediction result). The prediction measurement SHALL span the embedding prerequisite and the model fan-out, not the fan-out alone.

#### Scenario: Embedding request latency captured end-to-end

- **WHEN** an embedding job is submitted and later completes
- **THEN** the elapsed time from submission to completion is observed as embedding request latency

#### Scenario: Prediction request latency covers embedding plus all models

- **WHEN** a prediction is submitted and its flow completes (embedding child then the model fan-out)
- **THEN** the elapsed time from submission to the final prediction result is observed as the prediction (embedding + all models) request latency, including the time spent waiting on the embedding prerequisite

#### Scenario: Request latency is distinguishable from worker processing time

- **WHEN** request latency and worker per-job processing latency are both recorded
- **THEN** queue/wait time is attributable by comparing the end-to-end request latency against the worker-side processing duration

### Requirement: Workers expose metrics for scraping

Each worker SHALL expose its metrics in Prometheus text format over an HTTP `/metrics` endpoint on a configurable port, so a scraping agent can collect them and remote-write to the metrics backend. The endpoint SHALL be served without disrupting BullMQ job processing, and SHALL be closed cleanly on shutdown.

#### Scenario: Metrics endpoint serves current values

- **WHEN** an agent issues `GET /metrics` against a worker
- **THEN** the worker responds with the current metric values in Prometheus text format

#### Scenario: Metrics server shuts down with the worker

- **WHEN** the worker receives SIGTERM and begins draining
- **THEN** the metrics HTTP server is closed as part of the shutdown sequence

#### Scenario: Endpoint port is configurable

- **WHEN** the worker is started with a configured metrics port
- **THEN** the `/metrics` endpoint is served on that port via the worker's typed config (not a direct `process.env` read)
