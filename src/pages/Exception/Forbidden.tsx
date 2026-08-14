// 403 页面，提示当前用户没有访问权限。
import { Button, Result } from 'antd';
import { useNavigate } from 'react-router';
import { useAuthStore } from '../../store/useAuthStore';
import { getDefaultPath } from '../../utils/roleHelper';

export default function Forbidden() {
  const navigate = useNavigate();
  const role = useAuthStore((state) => state.role);

  return (
    <Result
      status="403"
      title="403"
      subTitle="当前账号无权访问该页面"
      extra={
        <Button
          type="primary"
          onClick={() => void navigate(role ? getDefaultPath(role) : '/login', { replace: true })}
        >
          返回首页
        </Button>
      }
    />
  );
}
