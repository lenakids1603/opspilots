import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import ProtectedRoute from "@/components/layout/ProtectedRoute";
import OpsLayout from "@/components/ops/OpsLayout";
import SupplierLayout from "@/components/supplier/SupplierLayout";
import Login from "./pages/Login";
import Signup from "./pages/Signup";
import OverviewPage from "./pages/ops/OverviewPage";
import SuppliersPage from "./pages/ops/SuppliersPage";
import ProductsPage from "./pages/ops/ProductsPage";
import SkusPage from "./pages/ops/SkusPage";

import SupplierBillsPage from "./pages/ops/SupplierBillsPage";
import UsersPage from "./pages/ops/UsersPage";
import SupplierAccountsPage from "./pages/ops/SupplierAccountsPage";
import OpsPlaceholder from "./pages/ops/OpsPlaceholder";
import RolesPage from "./pages/ops/RolesPage";
import FinanceOverviewPage from "./pages/ops/FinanceOverviewPage";
import CashflowPage from "./pages/ops/CashflowPage";
import FinanceMasterDataPage from "./pages/ops/FinanceMasterDataPage";
import JstSyncPage from "./pages/ops/JstSyncPage";
import JstProductSyncPage from "./pages/ops/JstProductSyncPage";
import JstDataIntegrationPage from "./pages/ops/JstDataIntegrationPage";
import PurchaseOrderManagementPage from "./pages/ops/PurchaseOrderManagementPage";
import InboundOrdersPage from "./pages/ops/InboundOrdersPage";
import OutboundOrdersPage from "./pages/ops/OutboundOrdersPage";
import SalesReturnOrdersPage from "./pages/ops/SalesReturnOrdersPage";
import DeliveryDashboardPage from "./pages/ops/DeliveryDashboardPage";
import SupplierDashboard from "./pages/supplier/SupplierDashboard";
import SupplierPurchaseOrdersPage from "./pages/supplier/PurchaseOrdersPage";
import SupplierPlaceholder from "./pages/supplier/SupplierPlaceholder";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const wrap = (el: React.ReactNode) => (
  <ProtectedRoute audience="internal"><OpsLayout>{el}</OpsLayout></ProtectedRoute>
);
const wrapSupplier = (el: React.ReactNode) => (
  <ProtectedRoute audience="supplier"><SupplierLayout>{el}</SupplierLayout></ProtectedRoute>
);

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/" element={wrap(<OverviewPage />)} />
          <Route path="/operations/analysis" element={wrap(<OpsPlaceholder breadcrumb={["运营分析"]} title="运营分析" description="销售、直播、达人、短视频引流等多维度运营数据分析" columns={["日期", "平台", "店铺", "销售额", "退款额", "净销售额", "操作"]} />)} />
          <Route path="/suppliers" element={wrap(<SuppliersPage />)} />
          <Route path="/products" element={wrap(<ProductsPage />)} />
          
          <Route path="/warehouse/inbound-orders" element={wrap(<InboundOrdersPage />)} />
          <Route path="/warehouse/outbound" element={wrap(<OutboundOrdersPage />)} />
          <Route path="/warehouse/sales-returns" element={wrap(<SalesReturnOrdersPage />)} />
          <Route path="/finance/supplier-bills" element={wrap(<SupplierBillsPage />)} />
          <Route path="/system/users" element={wrap(<UsersPage />)} />

          {/* 财税系统 */}
          <Route path="/finance/overview" element={wrap(<FinanceOverviewPage />)} />
          <Route path="/finance/cashflow" element={wrap(<CashflowPage />)} />
          <Route path="/finance/entities" element={wrap(<FinanceMasterDataPage />)} />
          <Route path="/finance/master-data" element={wrap(<FinanceMasterDataPage />)} />

          {/* 供应商系统 */}
          <Route path="/suppliers/overview" element={wrap(<OpsPlaceholder breadcrumb={["供应商系统", "供应商总览"]} title="供应商总览" description="核心供应商业绩、交期、质量指标全景" columns={["供应商", "在途订单", "本月入库", "应付金额", "交期达成率", "客诉数"]} />)} />
          <Route path="/suppliers/po-alerts" element={wrap(<OpsPlaceholder breadcrumb={["运维系统", "订单超时预警"]} title="订单超时预警" description="订单交期超时、未发货订单联动预警" columns={["订单号", "供应商", "款号", "应交日期", "已超期天数", "状态", "操作"]} />)} />

          {/* 采购系统 */}
          <Route path="/purchase/orders" element={wrap(<PurchaseOrderManagementPage />)} />
          <Route path="/purchase/delivery-dashboard" element={wrap(<DeliveryDashboardPage />)} />

          {/* 商品系统 */}
          <Route path="/products/image-search" element={wrap(<OpsPlaceholder breadcrumb={["商品系统", "图片搜索入口"]} title="图片搜索入口" description="上传图片快速定位款号 / SKU（规划中）" columns={["上传时间", "图片", "匹配款号", "相似度", "操作"]} />)} />

          {/* 客服 / 售后 */}
          <Route path="/cs/complaints" element={wrap(<OpsPlaceholder breadcrumb={["客服 / 售后", "商品投诉登记"]} title="商品投诉登记" description="客服快速登记投诉、上传图片、关联订单与款号" columns={["投诉编号", "日期", "款号", "投诉类型", "处理状态", "操作"]} />)} />

          {/* 数据中心 */}
          <Route path="/data-center" element={wrap(<OpsPlaceholder breadcrumb={["数据中心"]} title="数据中心" description="销售、退款、直播、达人多维数据汇总" columns={["数据集", "来源", "更新时间", "记录数", "状态", "操作"]} />)} />
          <Route path="/data-center/jst-integration" element={wrap(<JstDataIntegrationPage />)} />

          {/* 系统设置 */}
          <Route path="/system/supplier-accounts" element={wrap(<SupplierAccountsPage />)} />
          <Route path="/system/roles" element={wrap(<RolesPage />)} />

          <Route path="/supplier" element={wrapSupplier(<SupplierDashboard />)} />
          <Route path="/supplier/orders" element={wrapSupplier(<SupplierPurchaseOrdersPage />)} />
          <Route path="/supplier/purchase-orders" element={wrapSupplier(<SupplierPurchaseOrdersPage />)} />
          <Route path="/supplier/quotes" element={wrapSupplier(<SupplierPlaceholder title="款式报价" description="维护商品报价与历史成本" columns={["款号", "商品", "颜色 / 尺码", "成本价", "采购价", "更新时间", "操作"]} />)} />
          <Route path="/supplier/bills" element={wrapSupplier(<SupplierPlaceholder title="对账结算" description="查看月度对账单与结算状态" columns={["账单号", "周期", "金额", "状态", "审核人", "操作"]} />)} />
          <Route path="/supplier/ranking" element={wrapSupplier(<SupplierPlaceholder title="考核排名" description="交期、品质、配合度多维度供应商排名" columns={["排名", "维度", "得分", "本月趋势", "对比"]} />)} />
          <Route path="/supplier/complaints" element={wrapSupplier(<SupplierPlaceholder title="客户投诉" description="商品质量投诉与售后反馈" columns={["投诉编号", "款号", "投诉类型", "数量", "处理状态", "操作"]} />)} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
