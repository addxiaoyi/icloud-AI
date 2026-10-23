import { Link } from 'react-router-dom'

interface NoAccountGuideProps {
  /** 可选: 描述当前页面想做什么 */
  intent?: string
}

/** 无账号时给出去账号页添加的引导 */
export default function NoAccountGuide({ intent }: NoAccountGuideProps) {
  return (
    <div className="empty-state">
      <p>暂无账号{intent ? `，${intent}` : ''}。</p>
      <p>
        <Link to="/accounts" className="link-like">
          前往「账号」页添加账号 →
        </Link>
      </p>
      <p className="hint">添加后可通过 iCloud 登录自动获取 Cookie，状态变为「正常」即可使用。</p>
    </div>
  )
}
