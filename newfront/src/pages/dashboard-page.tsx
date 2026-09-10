import { useEffect, useState, type ReactNode } from "react";
import { Link } from "wouter";
import {
  ArrowUpRight,
  BrainCircuit,
  Check,
  ShieldAlert,
  Siren,
  SlidersHorizontal,
} from "lucide-react";
import { T } from "@/lib/i18n";
import {
  getERForecast,
  getICUForecast,
  type ERForecastResponse,
  type ICUForecastResponse,
} from "@/api/forecast";
import { getERSummary } from "@/api/er-summary";
import { getDigitalTwin, type DigitalTwinResponse } from "@/api/digital-twin";
import {
  getInsights,
  type Insight as LiveInsight,
  type InsightsResponse,
} from "@/api/insights";
import { getHospitalSummary, type HospitalSummary } from "@/api/dashboard";
import {
  DepartmentTable,
  ForecastChart,
  Metric,
  card,
} from "@/components/command-page-shared";
import { KpiCard, PageHeader, SectionTitle } from "@/components/command-shell";
import type { DepartmentStatus } from "@/lib/ops-data";

type CoreDashboardData = {
  summary?: HospitalSummary;
  twin?: DigitalTwinResponse;
  insights?: InsightsResponse;
  errors: string[];
};

function withTimeout<T>(request: Promise<T>, label: string, timeoutMs = 8000) {
  return Promise.race([
    request,
    new Promise<T>((_, reject) => {
      window.setTimeout(
        () => reject(new Error(`${label} timed out.`)),
        timeoutMs,
      );
    }),
  ]);
}

async function loadCoreData(): Promise<CoreDashboardData> {
  const results = await Promise.allSettled([
    withTimeout(getHospitalSummary(), "Hospital summary"),
    withTimeout(getDigitalTwin(), "Digital twin"),
    withTimeout(getInsights(), "AI insights"),
  ]);
  const value = <T,>(index: number): T | undefined => {
    const result = results[index];
    return result.status === "fulfilled" ? (result.value as T) : undefined;
  };

  return {
    summary: value<HospitalSummary>(0),
    twin: value<DigitalTwinResponse>(1),
    insights: value<InsightsResponse>(2),
    errors: results.flatMap((result) =>
      result.status === "rejected"
        ? [
            result.reason instanceof Error
              ? result.reason.message
              : "An API request failed.",
          ]
        : [],
    ),
  };
}

function formatForecastTime(value: string | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function forecastToChart(
  forecast:
    | ERForecastResponse["forecast"]
    | ICUForecastResponse["forecast"]
    | undefined,
  isEr: boolean,
) {
  if (!forecast) return [];
  return forecast.map((point) => ({
    timestamp: isEr
      ? (point as ERForecastResponse["forecast"][number]).time
      : (point as ICUForecastResponse["forecast"][number]).timestamp,
    actual: null,
    forecast: isEr
      ? (point as ERForecastResponse["forecast"][number]).predicted_arrivals
      : (point as ICUForecastResponse["forecast"][number]).forecast_occupancy,
    lowerBound: point.lower_bound,
    upperBound: point.upper_bound,
  }));
}

function liveDepartments(
  twin: DigitalTwinResponse | undefined,
): DepartmentStatus[] {
  if (!twin) return [];
  return Object.values(twin.departments).map((department) => {
    const capacity = twin.beds.filter(
      (bed) => bed.department_id === department.department_id,
    ).length;
    const occupancy = Math.round(department.occupancy);
    return {
      id: String(department.department_id),
      name: department.name,
      status: occupancy > 92 ? "critical" : occupancy > 88 ? "watch" : "stable",
      occupancy,
      capacity,
      availableBeds: department.available,
      trend: 0,
      live: true,
    };
  });
}

function DynamicInsight({ insight }: { insight: LiveInsight }) {
  return (
    <div className={`${card} p-4`}>
      <div className="flex items-start gap-3">
        <span
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${insight.severity === "critical" ? "bg-[#d76655]" : insight.severity === "watch" ? "bg-[#e3a13e]" : "bg-[#4cae9b]"}`}
        />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <strong className="text-[13px] text-[#2d444c]">
              {insight.title}
            </strong>
            <span className="mono text-[10px] uppercase text-[#84928e]">
              {insight.department}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-[#73817f]">
            {insight.description}
          </p>
          {insight.evidence.length > 0 && (
            <p className="mt-2 text-[10px] text-[#84928e]">
              {insight.evidence
                .map((item) => `${item.label}: ${item.value}`)
                .join(" · ")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function DynamicPriority({
  tone,
  icon,
  title,
  text,
  href,
}: {
  tone: "critical" | "watch" | "stable";
  icon: ReactNode;
  title: string;
  text: string;
  href: string;
}) {
  const styles = {
    critical: "border-[#f0d4cc] bg-[#fff8f5] text-[#be5b49]",
    watch: "border-[#efdfbd] bg-[#fffbf2] text-[#9a7029]",
    stable: "border-[#d3e8e0] bg-[#f4fbf8] text-[#398271]",
  };
  return (
    <div className={`rounded-lg border p-4 ${styles[tone]}`}>
      <div className="flex justify-between">
        <span className="text-[10px] font-bold uppercase tracking-wider">
          {tone}
        </span>
        {icon}
      </div>
      <div className="mt-3 text-sm font-bold text-[#3b4549]">{title}</div>
      <p className="mt-1.5 text-[11px] leading-relaxed text-[#7f7772]">
        {text}
      </p>
      <Link
        href={href}
        className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold"
      >
        View operational detail <ArrowUpRight className="h-3 w-3" />
      </Link>
    </div>
  );
}

export function Dashboard() {
  const [coreData, setCoreData] = useState<CoreDashboardData | null>(null);
  const [coreLoading, setCoreLoading] = useState(true);
  const [erSummary, setErSummary] = useState<Awaited<ReturnType<typeof getERSummary>> | null>(null);
  const [erForecast, setErForecast] = useState<ERForecastResponse | null>(null);
  const [icuForecast, setIcuForecast] = useState<ICUForecastResponse | null>(
    null,
  );
  const [erForecastLoading, setErForecastLoading] = useState(true);
  const [icuForecastLoading, setIcuForecastLoading] = useState(true);
  const [erForecastError, setErForecastError] = useState<string | null>(null);
  const [icuForecastError, setIcuForecastError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setCoreLoading(true);
    loadCoreData()
      .then((result) => {
        if (active) setCoreData(result);
      })
      .finally(() => {
        if (active) setCoreLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    withTimeout(getERSummary(), "ER summary")
      .then((result) => {
        if (active) setErSummary(result);
      })
      .catch(() => {
        // Keep the KPI unavailable rather than replacing a failed API result with a fake value.
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setErForecastLoading(true);
    setErForecastError(null);
    getERForecast(24)
      .then((result) => {
        if (active) setErForecast(result);
      })
      .catch((reason) => {
        if (active)
          setErForecastError(
            reason instanceof Error
              ? reason.message
              : "ER forecast unavailable.",
          );
      })
      .finally(() => {
        if (active) setErForecastLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setIcuForecastLoading(true);
    setIcuForecastError(null);
    getICUForecast(24)
      .then((result) => {
        if (active) setIcuForecast(result);
      })
      .catch((reason) => {
        if (active)
          setIcuForecastError(
            reason instanceof Error
              ? reason.message
              : "ICU forecast unavailable.",
          );
      })
      .finally(() => {
        if (active) setIcuForecastLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const summary = coreData?.summary;
  const er = erSummary;
  const twin = coreData?.twin;
  const departments = liveDepartments(twin);
  const activeVisits = summary?.active_visits;
  const hospitalAvailable = summary
    ? summary.total_beds - summary.occupied_beds
    : undefined;
  const patientsWaiting = erSummary?.patients_waiting ?? 0;
  const icuBuffer = icuForecast?.available_beds;
  const topInsights = coreData?.insights?.insights.slice(0, 3) ?? [];
  const erChart = forecastToChart(erForecast?.forecast, true);
  const icuChart = forecastToChart(icuForecast?.forecast, false);
  const erTrend =
    erChart.length > 1
      ? erChart[erChart.length - 1].forecast - erChart[0].forecast
      : undefined;
  const pendingTransfers = twin
    ? Object.values(twin.departments).reduce(
        (total, item) => total + item.pending_transfers,
        0,
      )
    : undefined;
  const plannedDischarges = twin
    ? Object.values(twin.departments).reduce(
        (total, item) => total + item.discharges_planned,
        0,
      )
    : undefined;

  if (coreLoading) {
    return (
      <div className={`${card} animate-rise p-6 text-sm text-[#697b79]`}>
        Loading live hospital state...
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <PageHeader
        eyebrow="dashboard.eyebrow"
        title="dashboard.title"
        description="dashboard.description"
        action={
          <span className="mono rounded-lg border border-[#dce4dc] bg-[#fbfaf7] px-3 py-2 text-[10px] text-[#697b79]">
            LIVE BACKEND STATE
          </span>
        }
      />
      {/* {coreData?.errors.length ? (
        <div className="mb-4 rounded-lg border border-[#eadb9b] bg-[#fffbea] p-3 text-xs text-[#8a7628]">  Loading
          live data...
        </div>
      ) : null} */}

      <section aria-labelledby="current-state">
        <div
          id="current-state"
          className="mb-3 mono text-[10px] uppercase tracking-[.18em] text-[#71858a]"
        >
          Current hospital state
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          <KpiCard
            label="dashboard.patientsInHouse"
            value={activeVisits ?? "-"}
            sub="dashboard.liveBackend"
            tone="slate"
          />
          <KpiCard
            label="dashboard.hospitalOccupancy"
            value={summary?.bed_occupancy_rate ?? "-"}
            unit="%"
            sub={
              hospitalAvailable === undefined
                ? "dashboard.liveBackend"
                : `${hospitalAvailable} beds available`
            }
            tone="teal"
          />
          {/* <KpiCard
            label="detail.patientsWaiting"
            value={String(er?.patients_waiting ?? "-")}
            sub="dashboard.liveBackend"
            tone="red"
            href="/er"
          /> */}
          <KpiCard
            label="dashboard.icuOccupancy"
            value={icuForecast?.current_occupancy ?? "-"}
            unit="%"
            sub={
              icuBuffer === undefined
                ? "dashboard.liveBackend"
                : `${icuBuffer} beds available`
            }
            tone="amber"
            href="/icu"
          />
        </div>
      </section>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.35fr_.9fr]">
        <section className={`${card} p-5`}>
          <SectionTitle
            title="dashboard.attention"
            meta="dashboard.attentionMeta"
          />
          <div className="grid gap-3 md:grid-cols-3">
            <DynamicPriority
              tone={icuBuffer === 0 ? "critical" : "watch"}
              icon={<ShieldAlert className="h-4 w-4" />}
              title="ICU capacity risk"
              text={
                icuForecast
                  ? `Occupancy is ${icuForecast.current_occupancy}% with ${icuBuffer} beds available now.`
                  : "ICU capacity data is unavailable."
              }
              href="/icu"
            />
            <DynamicPriority
              tone={(er?.waiting_over_60 ?? 0) > 0 ? "watch" : "stable"}
              icon={<Siren className="h-4 w-4" />}
              title="ER pressure"
              text={
                er
                  ? `${er.patients_waiting} patients waiting; ${er.waiting_over_60} have waited over 60 minutes.`
                  : "ER summary data is unavailable."
              }
              href="/er"
            />
            <DynamicPriority
              tone={(pendingTransfers ?? 0) > 0 ? "watch" : "stable"}
              icon={<Check className="h-4 w-4" />}
              title="Transfer and bed flow"
              text={
                twin
                  ? `${pendingTransfers} pending transfers across the digital twin.`
                  : "Digital twin data is unavailable."
              }
              href="/simulation"
            />
          </div>
        </section>
        <section className={`${card} p-5`}>
          <SectionTitle
            title="dashboard.operationalPulse"
            meta="dashboard.operationalPulseMeta"
          />
          <div className="space-y-5">
            <Metric
              label="dashboard.admissionsToday"
              value={summary ? `${summary.active_visits}` : "-"}
              sub="dashboard.liveBackend"
            />
            <Metric
              label="dashboard.dischargesToday"
              value={
                plannedDischarges === undefined ? "-" : `${plannedDischarges}`
              }
              sub="dashboard.liveBackend"
            />
            <Metric
              label="dashboard.medianWait"
              value={er ? `${er.median_wait_minutes}m` : "-"}
              sub="dashboard.liveBackend"
            />
            <Metric
              label="dashboard.transferRequests"
              value={
                pendingTransfers === undefined ? "-" : `${pendingTransfers}`
              }
              sub="dashboard.liveBackend"
            />
          </div>
        </section>
      </div>

      <section className="mt-6" aria-labelledby="future-state">
        <div
          id="future-state"
          className="mb-3 mono text-[10px] uppercase tracking-[.18em] text-[#71858a]"
        >
          Future state / bounded forecast
        </div>
        <div className="grid gap-5 xl:grid-cols-2">
          <div className={`${card} p-5`}>
            <SectionTitle
              title="forecast.emergencyDemand"
              meta="forecast.observedForecast"
            />
            {erForecastLoading ? (
              <p className="py-12 text-sm text-[#84928e]">
                Loading ER forecast...
              </p>
            ) : erForecastError ? (
              <p className="py-12 text-sm text-[#a95848]">{erForecastError}</p>
            ) : erChart.length > 0 ? (
              <ForecastChart
                data={erChart}
                label="dashboard-er"
                yDomain={[
                  0,
                  Math.max(10, ...erChart.map((point) => point.upperBound)),
                ]}
              />
            ) : (
              <p className="py-12 text-sm text-[#84928e]">
                ER forecast unavailable.
              </p>
            )}
            <div className="grid grid-cols-3 gap-3 border-t border-[#e2e8e1] pt-4 text-xs">
              <Metric
                label="forecast.now"
                value={erForecast ? `${erForecast.current_arrivals}` : "-"}
                sub="forecast.arrivalsIndex"
              />
              <Metric
                label="forecast.peak"
                value={erForecast ? `${erForecast.peak_arrivals}` : "-"}
                sub="forecast.forecastAt"
              />
              <Metric
                label="forecast.forecastAt"
                value={
                  erChart.length > 0
                    ? `${erChart[erChart.length - 1].forecast}`
                    : "-"
                }
                sub="forecast.arrivalsIndex"
              />
            </div>
            {erForecast ? (
              <p className="mt-2 text-[10px] text-[#84928e]">
                Peak at {formatForecastTime(erForecast.peak_time)} ·{" "}
                {erTrend === undefined
                  ? "Trend unavailable"
                  : erTrend > 0
                    ? "Trend rising"
                    : erTrend < 0
                      ? "Trend easing"
                      : "Trend stable"}{" "}
                · 24h window
              </p>
            ) : null}
          </div>
          <div className={`${card} p-5`}>
            <SectionTitle
              title="forecast.icuOccupancy"
              meta="forecast.staffedBedForecast"
            />
            {icuForecastLoading ? (
              <p className="py-12 text-sm text-[#84928e]">
                Loading ICU forecast...
              </p>
            ) : icuForecastError ? (
              <p className="py-12 text-sm text-[#a95848]">{icuForecastError}</p>
            ) : icuChart.length > 0 ? (
              <ForecastChart
                data={icuChart}
                label="dashboard-icu"
                color="#c88443"
                yDomain={[0, 100]}
              />
            ) : (
              <p className="py-12 text-sm text-[#84928e]">
                ICU forecast unavailable.
              </p>
            )}
            <div className="grid grid-cols-3 gap-3 border-t border-[#e2e8e1] pt-4 text-xs">
              <Metric
                label="forecast.now"
                value={icuForecast ? `${icuForecast.current_occupancy}%` : "-"}
                sub="forecast.occupiedOf"
              />
              <Metric
                label="forecast.peak"
                value={icuForecast ? `${icuForecast.peak_occupancy}%` : "-"}
                sub="forecast.forecastAt"
              />
              <Metric
                label="forecast.buffer"
                value={icuForecast ? `${icuForecast.available_beds}` : "-"}
                sub="common.beds"
              />
            </div>
            {icuForecast ? (
              <p className="mt-2 text-[10px] text-[#84928e]">
                Peak at {formatForecastTime(icuForecast.peak_time)} ·{" "}
                {icuForecast.total_icu_beds} total ICU beds
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="mt-6 grid gap-5 xl:grid-cols-[1.4fr_.8fr]">
        <div className={`${card} p-5`}>
          <SectionTitle
            title="dashboard.capacityByDepartment"
            meta="dashboard.capacityMeta"
            action={
              <Link
                className="text-xs font-bold text-[#378d87]"
                href="/digital-twin"
              >
                <T id="common.openDigitalTwin" />{" "}
                <ArrowUpRight className="inline h-3.5 w-3.5" />
              </Link>
            }
          />
          {departments.length > 0 ? (
            <DepartmentTable rows={departments} />
          ) : (
            <p className="py-6 text-sm text-[#84928e]">
              Capacity data unavailable.
            </p>
          )}
        </div>
        <div>
          <SectionTitle
            title="dashboard.latestInsights"
            meta="dashboard.latestInsightsMeta"
            action={
              <Link
                href="/insights"
                className="text-xs font-bold text-[#378d87]"
              >
                <T id="common.viewAll" />
              </Link>
            }
          />
          <div className="space-y-3">
            {topInsights.length > 0 ? (
              topInsights.map((insight) => (
                <DynamicInsight key={insight.id} insight={insight} />
              ))
            ) : (
              <p className="text-sm text-[#84928e]">AI insights unavailable.</p>
            )}
          </div>
        </div>
      </section>

      <section
        className={`${card} mt-6 flex flex-col gap-4 border-[#bcded3] bg-[#f2faf6] p-5 md:flex-row md:items-center md:justify-between`}
      >
        <div className="flex gap-3">
          <div className="rounded-lg bg-[#d5ebe3] p-2 text-[#398475]">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-base font-bold text-[#355458]">
              Test a decision before taking action
            </h2>
            <p className="mt-1 text-xs text-[#71857f]">
              Use the Digital Twin to simulate operational scenarios and
              understand their impact before making a real-world decision.
            </p>
          </div>
        </div>
        <Link
          href="/simulation"
          className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-[#2b7771] px-4 py-2.5 text-xs font-bold text-white hover:bg-[#22645f]"
        >
          <SlidersHorizontal className="h-4 w-4" /> Run What-If Simulation
        </Link>
      </section>
    </div>
  );
}
