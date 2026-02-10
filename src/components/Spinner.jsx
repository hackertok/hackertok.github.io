export function Spinner({ size = 'md' }) {
  const sizeClasses = {
    sm: 'w-4 h-4 border-2',
    md: 'w-6 h-6 border-2',
    lg: 'w-8 h-8 border-2',
  };

  return (
    <div className="flex justify-center items-center py-6">
      <div
        className={`${sizeClasses[size]} border-gray-200 dark:border-gray-700 border-t-hn-orange rounded-full animate-spin`}
      />
    </div>
  );
}
