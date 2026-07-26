import { Card, Col, Divider, Row, Skeleton } from 'antd';
import './SkeletonLoader.css';

/**
 * SkeletonLoader — 通用页面骨架屏组件
 *
 * 用法:
 *   {loading ? <SkeletonLoader variant="table" /> : <RealContent ... />}
 */
export interface SkeletonLoaderProps {
  variant?: 'table' | 'card-grid' | 'content';
}

export default function SkeletonLoader({ variant = 'content' }: SkeletonLoaderProps) {
  return (
    <div className="skeleton-loader">
      {/* Page header skeleton */}
      <div className="skeleton-header">
        <Skeleton active paragraph={false} title={{ width: '30%' }} />
        <Skeleton active paragraph={false} title={{ width: '60%' }} />
      </div>

      {/* Card content skeleton */}
      <Card className="skeleton-card">
        {variant === 'table' ? (
          <>
            <Skeleton active paragraph={{ rows: 4 }} />
            <Divider />
            <Skeleton active paragraph={{ rows: 4 }} />
            <Divider />
            <Skeleton active paragraph={{ rows: 4 }} />
          </>
        ) : variant === 'card-grid' ? (
          <Row gutter={[16, 16]}>
            {[1, 2, 3, 4].map((i) => (
              <Col key={i} xs={24} sm={12} lg={6}>
                <Card>
                  <Skeleton active paragraph={{ rows: 2 }} />
                </Card>
              </Col>
            ))}
          </Row>
        ) : (
          <>
            <Skeleton active paragraph={{ rows: 6 }} />
            <Divider />
            <Skeleton active paragraph={{ rows: 4 }} />
          </>
        )}
      </Card>
    </div>
  );
}
