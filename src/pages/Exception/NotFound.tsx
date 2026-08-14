// 404 页面，提示当前地址不存在。
import { Button, Result } from 'antd';
import { useNavigate } from 'react-router';

export default function NotFound() {
  const navigate = useNavigate();

  return (
    <Result
      status="404"
      title="404"
      subTitle="页面不存在"
      extra={
        <Button type="primary" onClick={() => void navigate('/dashboard', { replace: true })}>
          返回首页
        </Button>
      }
    />
  );
}
