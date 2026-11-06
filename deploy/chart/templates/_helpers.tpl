{{/*
Fully qualified resource name. Intentionally the chart name (not `<release>-<chart>`), so resources
land as `mcpgw` regardless of release name, and kubectl access stays predictable.
*/}}
{{- define "mcpgw.fullname" -}}
{{- .Chart.Name -}}
{{- end -}}

{{- define "mcpgw.labels" -}}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
app.kubernetes.io/part-of: mcpgw
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{/*
Selector labels. They must stay stable across chart versions.
*/}}
{{- define "mcpgw.selectorLabels" -}}
app.kubernetes.io/name: mcpgw
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
