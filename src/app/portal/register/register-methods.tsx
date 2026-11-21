'use client'

import { useState } from 'react'
import RegisterForm from './register-form'
import PhoneRegisterForm from './phone-register-form'

export default function RegisterMethods({
  next,
  fromProspect,
  zh,
  authFailed,
  phoneSignupEnabled,
}: {
  next: string
  fromProspect: boolean
  zh: boolean
  authFailed: boolean
  phoneSignupEnabled: boolean
}) {
  const [method, setMethod] = useState<'phone' | 'email'>(phoneSignupEnabled ? 'phone' : 'email')
  return (
    <div>
      {method === 'phone' && phoneSignupEnabled
        ? <PhoneRegisterForm next={next} zh={zh} />
        : <RegisterForm next={next} fromProspect={fromProspect} zh={zh} authFailed={authFailed} />}
      {phoneSignupEnabled && (
        <button
          type="button"
          className="mt-4 w-full text-center text-sm font-semibold text-me-ochre hover:underline"
          onClick={() => setMethod(value => value === 'phone' ? 'email' : 'phone')}
        >
          {method === 'phone'
            ? (zh ? '使用邮箱注册' : 'Register with email')
            : (zh ? '使用手机号注册' : 'Register with phone')}
        </button>
      )}
    </div>
  )
}
